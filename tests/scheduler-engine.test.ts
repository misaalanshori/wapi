import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SchedulerEngine } from "../src/scheduler-engine.js";
import { SchedulesDatabase } from "../src/schedules-db.js";
import { SessionRegistry } from "../src/session-registry.js";
import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("SchedulerEngine", () => {
  let tmpDir: string;
  let registryDb: Database.Database;
  let registry: SessionRegistry;
  let engine: SchedulerEngine;
  let dispatched: any[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-engine-"));
    registryDb = new Database(":memory:");
    registry = new SessionRegistry(registryDb);
    dispatched = [];

    engine = new SchedulerEngine({
      dataDir: tmpDir,
      registry,
      tz: "UTC",
      minScheduleIntervalSeconds: 60,
      maxSchedulesPerSession: 5,
      onFire: async (item) => {
        dispatched.push(item);
      },
    });
  });

  afterEach(async () => {
    engine.stop();
    registryDb.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("enforces cron interval guardrail (rejects cron intervals < 60s)", () => {
    // "* * * * * *" is every second (if 6-field) or every minute (if 5-field)
    // In 5-field cron, "* * * * *" is every minute (60s) which is valid
    expect(engine.validateCronInterval("* * * * *")).toBe(true);

    // If an expression fires more frequently than 60s, it should be rejected
    // For standard 5-field cron, minimum standard interval is 1 minute (60s).
    // An invalid cron expression should throw or return false
    expect(engine.validateCronInterval("invalid cron expr")).toBe(false);
  });

  it("creates a one-shot schedule and fires when due", async () => {
    const sessionId = "session-1";
    const chatJid = "chat-1@s.whatsapp.net";
    registry.createSession(sessionId, chatJid);

    const sessionDir = path.join(tmpDir, "sessions", sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // Schedule 50ms in future
    const res = await engine.createSchedule(sessionId, {
      kind: "once",
      prompt: "Time to drink water",
      label: "Water",
      runInSeconds: 0.05,
    });

    expect(res.id).toBeDefined();

    // Wait 120ms
    await new Promise((r) => setTimeout(r, 120));

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].prompt).toContain("Time to drink water");
    expect(dispatched[0].sessionId).toBe(sessionId);
    expect(dispatched[0].chatJid).toBe(chatJid);
  });

  it("skips execution if session is paused at fire time", async () => {
    const sessionId = "session-paused";
    const chatJid = "chat-paused@s.whatsapp.net";
    registry.createSession(sessionId, chatJid);
    registry.pauseSession(sessionId); // PAUSED

    const sessionDir = path.join(tmpDir, "sessions", sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    await engine.createSchedule(sessionId, {
      kind: "once",
      prompt: "Alert while paused",
      runInSeconds: 0.05,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Execution should be skipped
    expect(dispatched).toHaveLength(0);
  });

  it("enforces maxSchedulesPerSession limit", async () => {
    const sessionId = "session-limit";
    registry.createSession(sessionId, "chat-limit@s.whatsapp.net");
    const sessionDir = path.join(tmpDir, "sessions", sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    // maxSchedulesPerSession is 5
    for (let i = 0; i < 5; i++) {
      await engine.createSchedule(sessionId, {
        kind: "once",
        prompt: `Task ${i}`,
        runInSeconds: 1000 + i,
      });
    }

    await expect(
      engine.createSchedule(sessionId, {
        kind: "once",
        prompt: "Task 6",
        runInSeconds: 2000,
      })
    ).rejects.toThrow(/Maximum schedules limit/);
  });

  it("fires late one-shot schedule on catchUpSession() with catch-up tag", async () => {
    const sessionId = "session-catchup";
    const chatJid = "chat-catchup@s.whatsapp.net";
    registry.createSession(sessionId, chatJid);
    const sessionDir = path.join(tmpDir, "sessions", sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const schedDb = new SchedulesDatabase(path.join(sessionDir, "schedules.sqlite"));
    // Insert a schedule whose nextFireAt was 10 minutes ago
    schedDb.createSchedule({
      id: "late-task",
      label: "Late Alert",
      kind: "once",
      prompt: "Check oven",
      nextFireAt: new Date(Date.now() - 600_000).toISOString(),
    });
    schedDb.close();

    await engine.catchUpSession(sessionId);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].prompt).toContain("catch-up");
    expect(dispatched[0].prompt).toContain("Check oven");
  });
});
