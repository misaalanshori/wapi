import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";
import { Type } from "@sinclair/typebox";

export interface SqliteStorageOptions {
  dbPath: string;
  backupDir: string;
  maxBackups?: number;
  maxRows?: number;
  maxChars?: number;
}

export interface QueryResult {
  rows: any[];
  truncated: boolean;
}

export class SqliteStorageService {
  private readonly dbPath: string;
  private readonly backupDir: string;
  private readonly maxBackups: number;
  private readonly maxRows: number;
  private readonly maxChars: number;
  private db: Database.Database;

  private readonly destructiveRegex =
    /\b(DROP\s+TABLE|DELETE\s+FROM\s+\S+(?!\s+WHERE)|ALTER\s+TABLE.*DROP\s+COLUMN)\b/i;

  constructor(options: SqliteStorageOptions) {
    this.dbPath = options.dbPath;
    this.backupDir = options.backupDir;
    this.maxBackups = options.maxBackups ?? 10;
    this.maxRows = options.maxRows ?? 200;
    this.maxChars = options.maxChars ?? 8000;

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
  }

  async schema(): Promise<string> {
    const tables = this.db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string; sql: string }[];

    if (tables.length === 0) {
      return "No user tables found in database. Create tables using exec or run.";
    }

    const lines: string[] = ["Database schema:"];
    for (const t of tables) {
      try {
        const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as {
          count: number;
        };
        lines.push(`\n-- ${t.name}: ${countRow.count} rows\n${t.sql};`);
      } catch {
        lines.push(`\n${t.sql};`);
      }
    }

    return lines.join("\n");
  }

  async all(sql: string, params: any[] = []): Promise<QueryResult> {
    const trimmed = sql.trim();
    const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase();
    if (!["SELECT", "PRAGMA", "EXPLAIN"].includes(firstWord)) {
      throw new Error(
        `Only SELECT, PRAGMA, or EXPLAIN statements are permitted in all(); received: "${firstWord}"`
      );
    }

    const rows = this.db.prepare(trimmed).all(...params) as any[];
    let truncated = false;
    let finalRows = rows;

    if (finalRows.length > this.maxRows) {
      finalRows = finalRows.slice(0, this.maxRows);
      truncated = true;
    }

    const json = JSON.stringify(finalRows);
    if (json.length > this.maxChars) {
      // Binary search or slice down
      while (finalRows.length > 1 && JSON.stringify(finalRows).length > this.maxChars) {
        finalRows = finalRows.slice(0, Math.floor(finalRows.length * 0.75));
      }
      truncated = true;
    }

    return {
      rows: finalRows,
      truncated,
    };
  }

  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const trimmed = sql.trim();
    if (this.destructiveRegex.test(trimmed)) {
      await this.backup("auto");
    }

    const result = this.db.prepare(trimmed).run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  async exec(sql: string): Promise<void> {
    const trimmed = sql.trim();
    if (this.destructiveRegex.test(trimmed)) {
      await this.backup("auto");
    }

    this.db.transaction(() => {
      this.db.exec(trimmed);
    })();
  }

  async backup(label: string = "manual"): Promise<string> {
    await fs.mkdir(this.backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${timestamp}-${safeLabel}.sqlite`;
    const targetPath = path.join(this.backupDir, filename);

    await this.db.backup(targetPath);
    await this.pruneBackups();
    return targetPath;
  }

  private async pruneBackups(): Promise<void> {
    try {
      const files = await fs.readdir(this.backupDir);
      const sqliteFiles: { name: string; mtime: number }[] = [];

      for (const file of files) {
        if (file.endsWith(".sqlite")) {
          const filePath = path.join(this.backupDir, file);
          const stat = await fs.stat(filePath);
          sqliteFiles.push({ name: file, mtime: stat.mtimeMs });
        }
      }

      // Sort newest first
      sqliteFiles.sort((a, b) => b.mtime - a.mtime);

      if (sqliteFiles.length > this.maxBackups) {
        const toDelete = sqliteFiles.slice(this.maxBackups);
        for (const f of toDelete) {
          await fs.unlink(path.join(this.backupDir, f.name)).catch(() => {});
        }
      }
    } catch {
      // non-fatal prune error
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}

export function registerSqliteStorageTool(dbPath: string, backupDir: string) {
  return (pi: any) => {
    let service: SqliteStorageService | null = null;

    const getService = () => {
      if (!service) {
        service = new SqliteStorageService({ dbPath, backupDir });
      }
      return service;
    };

    if (typeof pi.on === "function") {
      pi.on("session_end", () => {
        service?.close();
        service = null;
      });
      pi.on("dispose", () => {
        service?.close();
        service = null;
      });
    }

    // Expose close on registered tool or pi for testing
    (pi as any).closeSqliteStorage = () => {
      service?.close();
      service = null;
    };

    pi.registerTool({
      name: "sqlite_storage",
      label: "SQLite Storage",
      description:
        "Persistent per-conversation SQLite memory. Actions: schema, all, run, exec, backup.",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("schema"),
          Type.Literal("all"),
          Type.Literal("run"),
          Type.Literal("exec"),
          Type.Literal("backup"),
        ]),
        sql: Type.Optional(Type.String({ description: "SQL statement for all, run, or exec" })),
        params: Type.Optional(
          Type.Array(Type.Any(), { description: "Parameters array for all or run" })
        ),
        label: Type.Optional(
          Type.String({ description: "Optional label tag for backup action" })
        ),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const s = getService();
        try {
          switch (params.action) {
            case "schema": {
              const res = await s.schema();
              return { content: [{ type: "text", text: res }] };
            }
            case "all": {
              if (!params.sql) {
                return {
                  isError: true,
                  content: [{ type: "text", text: "Missing required parameter 'sql' for action 'all'" }],
                };
              }
              const res = await s.all(params.sql, params.params || []);
              let text = JSON.stringify(res.rows, null, 2);
              if (res.truncated) {
                text +=
                  "\n\n[Truncated: query returned more than 200 rows or 8000 characters; please narrow your query with WHERE/LIMIT]";
              }
              return { content: [{ type: "text", text }] };
            }
            case "run": {
              if (!params.sql) {
                return {
                  isError: true,
                  content: [{ type: "text", text: "Missing required parameter 'sql' for action 'run'" }],
                };
              }
              const res = await s.run(params.sql, params.params || []);
              return { content: [{ type: "text", text: JSON.stringify(res) }] };
            }
            case "exec": {
              if (!params.sql) {
                return {
                  isError: true,
                  content: [{ type: "text", text: "Missing required parameter 'sql' for action 'exec'" }],
                };
              }
              await s.exec(params.sql);
              return { content: [{ type: "text", text: "Execution successful" }] };
            }
            case "backup": {
              const file = await s.backup(params.label || "manual");
              return { content: [{ type: "text", text: `Backup saved to ${file}` }] };
            }
            default:
              return {
                isError: true,
                content: [{ type: "text", text: `Unknown action: ${params.action}` }],
              };
          }
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: "text", text: err.message || String(err) }],
          };
        }
      },
    });
  };
}
