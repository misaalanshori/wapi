import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SchedulesDatabase } from "../src/schedules-db.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("SchedulesDatabase", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: SchedulesDatabase;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-sched-"));
    dbPath = path.join(tmpDir, "schedules.sqlite");
    db = new SchedulesDatabase(dbPath);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a one-shot schedule", () => {
    const record = db.createSchedule({
      id: "sched-1",
      label: "Test Reminder",
      kind: "once",
      prompt: "Remind me to call John",
      nextFireAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(record.id).toBe("sched-1");
    expect(record.enabled).toBe(1);
    expect(record.kind).toBe("once");

    const retrieved = db.getSchedule("sched-1");
    expect(retrieved?.prompt).toBe("Remind me to call John");
  });

  it("creates and retrieves a recurring schedule", () => {
    const record = db.createSchedule({
      id: "sched-2",
      label: "Morning Briefing",
      kind: "recurring",
      cronExpr: "0 8 * * *",
      prompt: "Give me a daily morning update",
      nextFireAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(record.kind).toBe("recurring");
    expect(record.cronExpr).toBe("0 8 * * *");
  });

  it("lists all enabled schedules", () => {
    db.createSchedule({
      id: "sched-a",
      kind: "once",
      prompt: "Task A",
      nextFireAt: new Date().toISOString(),
    });
    db.createSchedule({
      id: "sched-b",
      kind: "once",
      prompt: "Task B",
      nextFireAt: new Date().toISOString(),
    });

    expect(db.listEnabledSchedules()).toHaveLength(2);

    db.cancelSchedule("sched-a");
    expect(db.listEnabledSchedules()).toHaveLength(1);
    expect(db.listEnabledSchedules()[0].id).toBe("sched-b");
  });

  it("updates schedule on fire", () => {
    db.createSchedule({
      id: "sched-once",
      kind: "once",
      prompt: "Task Once",
      nextFireAt: new Date().toISOString(),
    });

    const fireTime = new Date().toISOString();
    db.markFired("sched-once", fireTime, null); // disabled once fired

    const updated = db.getSchedule("sched-once");
    expect(updated?.enabled).toBe(0);
    expect(updated?.lastFiredAt).toBe(fireTime);
  });
});
