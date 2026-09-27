import Database from "better-sqlite3";

export interface ScheduleRecord {
  id: string;
  label?: string | null;
  kind: "once" | "recurring";
  cronExpr?: string | null;
  prompt: string;
  createdAt: string;
  nextFireAt: string;
  lastFiredAt?: string | null;
  enabled: number;
}

export class SchedulesDatabase {
  private readonly db: Database.Database;

  constructor(dbPathOrDb: string | Database.Database) {
    if (typeof dbPathOrDb === "string") {
      this.db = new Database(dbPathOrDb);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
    } else {
      this.db = dbPathOrDb;
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id             TEXT PRIMARY KEY,
        label          TEXT,
        kind           TEXT NOT NULL CHECK (kind IN ('once','recurring')),
        cron_expr      TEXT,
        prompt         TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        next_fire_at   TEXT NOT NULL,
        last_fired_at  TEXT,
        enabled        INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
      CREATE INDEX IF NOT EXISTS idx_schedules_next_fire ON schedules(next_fire_at);
    `);
  }

  createSchedule(record: {
    id: string;
    label?: string | null;
    kind: "once" | "recurring";
    cronExpr?: string | null;
    prompt: string;
    nextFireAt: string;
  }): ScheduleRecord {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO schedules (id, label, kind, cron_expr, prompt, created_at, next_fire_at, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(
      record.id,
      record.label || null,
      record.kind,
      record.cronExpr || null,
      record.prompt,
      createdAt,
      record.nextFireAt
    );

    return {
      id: record.id,
      label: record.label || null,
      kind: record.kind,
      cronExpr: record.cronExpr || null,
      prompt: record.prompt,
      createdAt,
      nextFireAt: record.nextFireAt,
      lastFiredAt: null,
      enabled: 1,
    };
  }

  getSchedule(id: string): ScheduleRecord | null {
    const row = this.db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  listEnabledSchedules(): ScheduleRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM schedules WHERE enabled = 1 ORDER BY next_fire_at ASC`)
      .all() as any[];
    return rows.map((r) => this.mapRow(r));
  }

  cancelSchedule(id: string): void {
    this.db.prepare(`UPDATE schedules SET enabled = 0 WHERE id = ?`).run(id);
  }

  markFired(id: string, firedAt: string, nextFireAt: string | null): void {
    if (nextFireAt) {
      this.db
        .prepare(`UPDATE schedules SET last_fired_at = ?, next_fire_at = ? WHERE id = ?`)
        .run(firedAt, nextFireAt, id);
    } else {
      this.db
        .prepare(
          `UPDATE schedules SET last_fired_at = ?, enabled = 0 WHERE id = ?`
        )
        .run(firedAt, id);
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }

  private mapRow(row: any): ScheduleRecord {
    return {
      id: row.id,
      label: row.label,
      kind: row.kind,
      cronExpr: row.cron_expr,
      prompt: row.prompt,
      createdAt: row.created_at,
      nextFireAt: row.next_fire_at,
      lastFiredAt: row.last_fired_at,
      enabled: row.enabled,
    };
  }
}
