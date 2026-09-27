import { describe, it, expect, beforeEach } from "vitest";
import { SessionRegistry } from "../src/session-registry.js";
import Database from "better-sqlite3";

describe("SessionRegistry", () => {
  let db: Database.Database;
  let registry: SessionRegistry;

  beforeEach(() => {
    db = new Database(":memory:");
    registry = new SessionRegistry(db);
  });

  it("creates and retrieves a new active session", () => {
    const session = registry.createSession("uuid-1", "chat-1@s.whatsapp.net");
    expect(session.id).toBe("uuid-1");
    expect(session.chatJid).toBe("chat-1@s.whatsapp.net");
    expect(session.status).toBe("active");

    const foundByChat = registry.findByChatJid("chat-1@s.whatsapp.net");
    expect(foundByChat?.id).toBe("uuid-1");
    expect(foundByChat?.status).toBe("active");

    const foundById = registry.findById("uuid-1");
    expect(foundById?.chatJid).toBe("chat-1@s.whatsapp.net");
  });

  it("pauses a session", () => {
    registry.createSession("uuid-1", "chat-1@s.whatsapp.net");
    registry.pauseSession("uuid-1");

    const session = registry.findById("uuid-1");
    expect(session?.status).toBe("paused");

    // Once paused, findActiveByChatJid returns null
    expect(registry.findActiveByChatJid("chat-1@s.whatsapp.net")).toBeNull();
  });

  it("resumes a session into a new chat JID", () => {
    registry.createSession("uuid-1", "chat-1@s.whatsapp.net");
    registry.pauseSession("uuid-1");

    const resumed = registry.resumeSession("uuid-1", "chat-2@s.whatsapp.net");
    expect(resumed.status).toBe("active");
    expect(resumed.chatJid).toBe("chat-2@s.whatsapp.net");

    expect(registry.findActiveByChatJid("chat-1@s.whatsapp.net")).toBeNull();
    expect(registry.findActiveByChatJid("chat-2@s.whatsapp.net")?.id).toBe("uuid-1");
  });

  it("touches session last_active_at", () => {
    registry.createSession("uuid-1", "chat-1@s.whatsapp.net");
    const initial = registry.findById("uuid-1")!;

    // Small delay to ensure timestamp changes or stays valid ISO
    registry.touchSession("uuid-1");
    const touched = registry.findById("uuid-1")!;
    expect(new Date(touched.lastActiveAt).getTime()).toBeGreaterThanOrEqual(
      new Date(initial.lastActiveAt).getTime()
    );
  });

  it("lists all active sessions", () => {
    registry.createSession("uuid-1", "chat-1@s.whatsapp.net");
    registry.createSession("uuid-2", "chat-2@s.whatsapp.net");
    registry.pauseSession("uuid-1");

    const active = registry.listActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("uuid-2");
  });
});
