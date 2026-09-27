import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStorageService } from "../src/sqlite-storage.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("SqliteStorageService", () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;
  let service: SqliteStorageService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-storage-"));
    dbPath = path.join(tmpDir, "storage.sqlite");
    backupDir = path.join(tmpDir, "storage-backups");
    service = new SqliteStorageService({ dbPath, backupDir, maxBackups: 3 });
  });

  afterEach(async () => {
    service.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty schema message when no tables exist", async () => {
    const schema = await service.schema();
    expect(schema).toContain("No user tables found in database");
  });

  it("creates tables via exec and returns schema with row counts", async () => {
    await service.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
      );
    `);

    await service.run("INSERT INTO notes (title, content) VALUES (?, ?)", ["Note 1", "Content 1"]);
    await service.run("INSERT INTO notes (title, content) VALUES (?, ?)", ["Note 2", "Content 2"]);
    await service.run("INSERT INTO tags (name) VALUES (?)", ["work"]);

    const schema = await service.schema();
    expect(schema).toContain("CREATE TABLE notes");
    expect(schema).toContain("CREATE TABLE tags");
    expect(schema).toContain("notes: 2 rows");
    expect(schema).toContain("tags: 1 rows");
  });

  it("executes SELECT and returns JSON formatted rows via all", async () => {
    await service.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);");
    await service.run("INSERT INTO items (name) VALUES (?)", ["Apples"]);
    await service.run("INSERT INTO items (name) VALUES (?)", ["Bananas"]);

    const result = await service.all("SELECT * FROM items WHERE name = ?", ["Apples"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Apples");
    expect(result.truncated).toBe(false);
  });

  it("rejects non-read verbs in all()", async () => {
    await service.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);");
    await expect(
      service.all("DELETE FROM items WHERE id = 1")
    ).rejects.toThrow(/Only SELECT, PRAGMA, or EXPLAIN/);
  });

  it("truncates large query results and flags truncation", async () => {
    await service.exec("CREATE TABLE big (id INTEGER PRIMARY KEY, text TEXT);");
    for (let i = 0; i < 250; i++) {
      await service.run("INSERT INTO big (text) VALUES (?)", [`Item ${i}`]);
    }

    const result = await service.all("SELECT * FROM big");
    expect(result.truncated).toBe(true);
    expect(result.rows.length).toBeLessThanOrEqual(200);
  });

  it("takes manual backup via backup()", async () => {
    await service.exec("CREATE TABLE test (val TEXT);");
    await service.run("INSERT INTO test VALUES (?)", ["hello"]);

    const backupFile = await service.backup("manual-test");
    expect(backupFile).toContain("manual-test");

    const exists = await fs.access(backupFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("takes automatic backup before destructive operations (DROP TABLE)", async () => {
    await service.exec("CREATE TABLE target (id INT);");
    const backupsBefore = await fs.readdir(backupDir).catch(() => []);
    expect(backupsBefore).toHaveLength(0);

    // DROP TABLE should trigger auto-backup
    await service.run("DROP TABLE target;");

    const backupsAfter = await fs.readdir(backupDir);
    expect(backupsAfter.length).toBeGreaterThan(0);
    expect(backupsAfter.some((f) => f.includes("auto"))).toBe(true);
  });

  it("prunes backups to maxBackups", async () => {
    await service.exec("CREATE TABLE dummy (id INT);");

    // Take 5 backups with maxBackups set to 3
    for (let i = 0; i < 5; i++) {
      await service.backup(`test-${i}`);
      // small delay to ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 10));
    }

    const files = await fs.readdir(backupDir);
    expect(files.length).toBeLessThanOrEqual(3);
  });
});
