import { describe, it, expect, beforeEach } from "vitest";
import { SessionGatekeeper } from "../../src/session-gatekeeper.js";
import { SessionRegistry } from "../../src/session-registry.js";
import Database from "better-sqlite3";

describe("Regression: Command handling with surrounding whitespace", () => {
  let db: Database.Database;
  let registry: SessionRegistry;
  let gatekeeper: SessionGatekeeper;

  beforeEach(() => {
    db = new Database(":memory:");
    registry = new SessionRegistry(db);
    gatekeeper = new SessionGatekeeper({
      secretWord: "secret123",
      registry,
      sessionExistsOnDisk: () => true,
    });
  });

  it("handles /init-session with irregular whitespace", async () => {
    const decision = await gatekeeper.handleMessage({
      chatJid: "chat-space@s.whatsapp.net",
      senderJid: "user@s.whatsapp.net",
      text: "   /init-session   secret123   ",
    });

    expect(decision.type).toBe("reply");
    if (decision.type === "reply") {
      expect(decision.text).toContain("session started");
    }
  });

  it("handles /deinit-session with newline and whitespace", async () => {
    registry.createSession("uuid-active", "chat-deinit@s.whatsapp.net");

    const decision = await gatekeeper.handleMessage({
      chatJid: "chat-deinit@s.whatsapp.net",
      senderJid: "user@s.whatsapp.net",
      text: " \n /deinit-session \n ",
    });

    expect(decision.type).toBe("reply");
    if (decision.type === "reply") {
      expect(decision.text).toContain("session paused");
    }
  });
});
