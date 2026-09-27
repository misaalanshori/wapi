import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { CronExpressionParser } from "cron-parser";
import { SchedulesDatabase, type ScheduleRecord } from "./schedules-db.js";
import type { SessionRegistry } from "./session-registry.js";

export interface ScheduledFireEvent {
  sessionId: string;
  chatJid: string;
  scheduleId: string;
  prompt: string;
}

export interface SchedulerEngineOptions {
  dataDir: string;
  registry: SessionRegistry;
  tz?: string;
  minScheduleIntervalSeconds?: number;
  maxSchedulesPerSession?: number;
  onFire: (item: ScheduledFireEvent) => Promise<void> | void;
}

interface HeapItem {
  sessionId: string;
  scheduleId: string;
  nextFireAt: number;
}

export class SchedulerEngine {
  private readonly dataDir: string;
  private readonly registry: SessionRegistry;
  private readonly tz: string;
  private readonly minScheduleIntervalSeconds: number;
  private readonly maxSchedulesPerSession: number;
  private readonly onFire: (item: ScheduledFireEvent) => Promise<void> | void;

  private heap: HeapItem[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(options: SchedulerEngineOptions) {
    this.dataDir = options.dataDir;
    this.registry = options.registry;
    this.tz = options.tz || "UTC";
    this.minScheduleIntervalSeconds = options.minScheduleIntervalSeconds ?? 60;
    this.maxSchedulesPerSession = options.maxSchedulesPerSession ?? 25;
    this.onFire = options.onFire;
  }

  private getSessionDb(sessionId: string): SchedulesDatabase {
    const sessionDir = path.join(this.dataDir, "sessions", sessionId);
    const dbPath = path.join(sessionDir, "schedules.sqlite");
    return new SchedulesDatabase(dbPath);
  }

  validateCronInterval(cronExpr: string): boolean {
    try {
      const parser = CronExpressionParser.parse(cronExpr, { tz: this.tz });
      const first = parser.next().toDate().getTime();
      const second = parser.next().toDate().getTime();
      const diffSec = (second - first) / 1000;
      return diffSec >= this.minScheduleIntervalSeconds;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    const sessionsDir = path.join(this.dataDir, "sessions");
    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionId = entry.name;
          await this.loadSessionSchedules(sessionId);
        }
      }
    } catch {
      // no sessions dir yet
    }

    this.armTimer();
  }

  private async loadSessionSchedules(sessionId: string): Promise<void> {
    const sessionDbPath = path.join(this.dataDir, "sessions", sessionId, "schedules.sqlite");
    try {
      await fs.access(sessionDbPath);
    } catch {
      return;
    }

    const db = this.getSessionDb(sessionId);
    try {
      const records = db.listEnabledSchedules();
      const now = Date.now();

      for (const rec of records) {
        let fireAtMs = new Date(rec.nextFireAt).getTime();

        if (rec.kind === "recurring") {
          // If fire time passed, compute next future occurrence
          if (fireAtMs <= now && rec.cronExpr) {
            try {
              const parser = CronExpressionParser.parse(rec.cronExpr, {
                tz: this.tz,
                currentDate: new Date(),
              });
              const nextDate = parser.next().toDate();
              fireAtMs = nextDate.getTime();
              db.markFired(rec.id, new Date(rec.nextFireAt).toISOString(), nextDate.toISOString());
            } catch {
              continue;
            }
          }
        }

        this.heap.push({
          sessionId,
          scheduleId: rec.id,
          nextFireAt: fireAtMs,
        });
      }
    } finally {
      db.close();
    }
  }

  async createSchedule(
    sessionId: string,
    params: {
      kind: "once" | "recurring";
      prompt: string;
      label?: string;
      cronExpr?: string;
      runAt?: string;
      runInSeconds?: number;
    }
  ): Promise<ScheduleRecord> {
    const db = this.getSessionDb(sessionId);
    try {
      const current = db.listEnabledSchedules();
      if (current.length >= this.maxSchedulesPerSession) {
        throw new Error(
          `Maximum schedules limit (${this.maxSchedulesPerSession}) reached for this session. Cancel existing schedules before creating new ones.`
        );
      }

      let nextFireAtDate: Date;

      if (params.kind === "recurring") {
        if (!params.cronExpr) {
          throw new Error("Missing required 'cronExpr' parameter for recurring schedule");
        }
        if (!this.validateCronInterval(params.cronExpr)) {
          throw new Error(
            `Invalid cron expression or interval shorter than ${this.minScheduleIntervalSeconds}s: "${params.cronExpr}"`
          );
        }

        const parser = CronExpressionParser.parse(params.cronExpr, {
          tz: this.tz,
          currentDate: new Date(),
        });
        nextFireAtDate = parser.next().toDate();
      } else {
        // Once
        if (params.runInSeconds !== undefined) {
          const ms = Math.max(0, params.runInSeconds * 1000);
          nextFireAtDate = new Date(Date.now() + ms);
        } else if (params.runAt) {
          const parsed = new Date(params.runAt);
          if (isNaN(parsed.getTime())) {
            throw new Error(`Invalid ISO date format for 'runAt': "${params.runAt}"`);
          }
          // Clamp past dates to now
          nextFireAtDate = parsed.getTime() < Date.now() ? new Date() : parsed;
        } else {
          throw new Error("One-shot schedule requires either 'runInSeconds' or 'runAt'");
        }
      }

      const id = crypto.randomUUID();
      const record = db.createSchedule({
        id,
        label: params.label,
        kind: params.kind,
        cronExpr: params.cronExpr,
        prompt: params.prompt,
        nextFireAt: nextFireAtDate.toISOString(),
      });

      this.heap.push({
        sessionId,
        scheduleId: id,
        nextFireAt: nextFireAtDate.getTime(),
      });

      this.armTimer();
      return record;
    } finally {
      db.close();
    }
  }

  async listSchedules(sessionId: string): Promise<ScheduleRecord[]> {
    const db = this.getSessionDb(sessionId);
    try {
      return db.listEnabledSchedules();
    } finally {
      db.close();
    }
  }

  async cancelSchedule(sessionId: string, scheduleId: string): Promise<void> {
    const db = this.getSessionDb(sessionId);
    try {
      db.cancelSchedule(scheduleId);
      this.heap = this.heap.filter(
        (item) => !(item.sessionId === sessionId && item.scheduleId === scheduleId)
      );
      this.armTimer();
    } finally {
      db.close();
    }
  }

  async catchUpSession(sessionId: string): Promise<void> {
    const db = this.getSessionDb(sessionId);
    try {
      const records = db.listEnabledSchedules();
      const now = Date.now();
      const session = this.registry.findById(sessionId);
      if (!session || session.status !== "active") return;

      for (const rec of records) {
        const fireAtMs = new Date(rec.nextFireAt).getTime();

        if (rec.kind === "once" && fireAtMs <= now) {
          const formattedPrompt = `[Scheduled task "${rec.label || rec.id}" fired at ${new Date().toISOString()} (catch-up)] ${rec.prompt}`;
          db.markFired(rec.id, new Date().toISOString(), null);

          this.heap = this.heap.filter(
            (i) => !(i.sessionId === sessionId && i.scheduleId === rec.id)
          );

          await this.onFire({
            sessionId,
            chatJid: session.chatJid,
            scheduleId: rec.id,
            prompt: formattedPrompt,
          });
        } else if (rec.kind === "recurring" && fireAtMs <= now && rec.cronExpr) {
          try {
            const parser = CronExpressionParser.parse(rec.cronExpr, {
              tz: this.tz,
              currentDate: new Date(),
            });
            const nextDate = parser.next().toDate();
            db.markFired(rec.id, new Date(rec.nextFireAt).toISOString(), nextDate.toISOString());

            this.heap = this.heap.filter(
              (i) => !(i.sessionId === sessionId && i.scheduleId === rec.id)
            );
            this.heap.push({
              sessionId,
              scheduleId: rec.id,
              nextFireAt: nextDate.getTime(),
            });
          } catch {
            // ignore
          }
        }
      }

      this.armTimer();
    } finally {
      db.close();
    }
  }

  private armTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.heap.length === 0) return;

    this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);
    const earliest = this.heap[0];
    const delay = Math.max(0, earliest.nextFireAt - Date.now());

    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    this.heap.sort((a, b) => a.nextFireAt - b.nextFireAt);

    while (this.heap.length > 0 && this.heap[0].nextFireAt <= now) {
      const item = this.heap.shift()!;
      const db = this.getSessionDb(item.sessionId);

      try {
        const sched = db.getSchedule(item.scheduleId);
        if (!sched || sched.enabled === 0) {
          continue;
        }

        const session = this.registry.findById(item.sessionId);
        const isActive = session && session.status === "active";

        if (isActive) {
          const formattedPrompt = `[Scheduled task "${sched.label || sched.id}" fired at ${new Date().toISOString()}] ${sched.prompt}`;
          try {
            await this.onFire({
              sessionId: item.sessionId,
              chatJid: session.chatJid,
              scheduleId: sched.id,
              prompt: formattedPrompt,
            });
          } catch {
            // non-fatal to engine
          }
        }

        if (sched.kind === "once") {
          db.markFired(sched.id, new Date().toISOString(), null);
        } else if (sched.kind === "recurring" && sched.cronExpr) {
          try {
            const parser = CronExpressionParser.parse(sched.cronExpr, {
              tz: this.tz,
              currentDate: new Date(),
            });
            const nextDate = parser.next().toDate();
            db.markFired(sched.id, new Date().toISOString(), nextDate.toISOString());

            this.heap.push({
              sessionId: item.sessionId,
              scheduleId: sched.id,
              nextFireAt: nextDate.getTime(),
            });
          } catch {
            // bad cron expression, disable
            db.cancelSchedule(sched.id);
          }
        }
      } finally {
        db.close();
      }
    }

    this.armTimer();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.heap = [];
  }
}
