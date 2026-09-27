import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerSqliteStorageTool } from "../src/sqlite-storage.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("registerSqliteStorageTool extension", () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;
  let registeredTool: any;
  let mockPi: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-tool-"));
    dbPath = path.join(tmpDir, "storage.sqlite");
    backupDir = path.join(tmpDir, "storage-backups");

    mockPi = {
      registerTool: vi.fn().mockImplementation((tool) => {
        registeredTool = tool;
      }),
    };

    const factory = registerSqliteStorageTool(dbPath, backupDir);
    factory(mockPi);
  });

  afterEach(async () => {
    mockPi.closeSqliteStorage?.();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("registers tool sqlite_storage with expected schema", () => {
    expect(mockPi.registerTool).toHaveBeenCalled();
    expect(registeredTool.name).toBe("sqlite_storage");
    expect(registeredTool.description).toBeDefined();
    expect(registeredTool.execute).toBeTypeOf("function");
  });

  it("executes schema, run, and all actions via the registered tool", async () => {
    // 1. schema empty
    const res1 = await registeredTool.execute("call-1", { action: "schema" });
    expect(res1.content[0].text).toContain("No user tables found");

    // 2. exec table creation
    const res2 = await registeredTool.execute("call-2", {
      action: "exec",
      sql: "CREATE TABLE reminders (id INT, text TEXT);",
    });
    expect(res2.isError).toBeFalsy();

    // 3. run insert
    const res3 = await registeredTool.execute("call-3", {
      action: "run",
      sql: "INSERT INTO reminders VALUES (?, ?)",
      params: [1, "Buy milk"],
    });
    expect(res3.isError).toBeFalsy();

    // 4. all select
    const res4 = await registeredTool.execute("call-4", {
      action: "all",
      sql: "SELECT * FROM reminders",
    });
    expect(res4.isError).toBeFalsy();
    expect(res4.content[0].text).toContain("Buy milk");

    // 5. backup
    const res5 = await registeredTool.execute("call-5", {
      action: "backup",
      label: "manual_snap",
    });
    expect(res5.content[0].text).toContain("Backup saved to");
  });

  it("returns isError: true on invalid SQL", async () => {
    const res = await registeredTool.execute("call-err", {
      action: "all",
      sql: "SELECT * FROM non_existent_table_xyz",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("no such table");
  });
});
