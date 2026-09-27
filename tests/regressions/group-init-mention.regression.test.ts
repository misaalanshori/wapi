import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionGatekeeper } from "../../src/session-gatekeeper.js";
import { SessionRegistry } from "../../src/session-registry.js";
import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Group Mention & Init Command Handling", () => {
  let dbPath: string;
  let db: Database.Database;
  let registry: SessionRegistry;
  let gatekeeper: SessionGatekeeper;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-reg-group-${Date.now()}-${Math.random()}.sqlite`);
    db = new Database(dbPath);
    registry = new SessionRegistry(db);

    gatekeeper = new SessionGatekeeper({
      secretWord: "correct-secret",
      registry,
      sessionExistsOnDisk: () => true,
    });
  });

  it("handles /init-session with a leading @mention tag", async () => {
    const decision = await gatekeeper.handleMessage({
      chatJid: "123456789-group@g.us",
      senderJid: "user@s.whatsapp.net",
      text: "@6285155247688 /init-session correct-secret",
    });

    expect(decision.type).toBe("reply");
    if (decision.type === "reply") {
      expect(decision.text).toContain("session started");
    }
  });

  it("handles /deinit-session with a leading @mention tag", async () => {
    // 1. Initialize
    await gatekeeper.handleMessage({
      chatJid: "123456789-group@g.us",
      senderJid: "user@s.whatsapp.net",
      text: "/init-session correct-secret",
    });

    // 2. Deinit with mention
    const decision = await gatekeeper.handleMessage({
      chatJid: "123456789-group@g.us",
      senderJid: "user@s.whatsapp.net",
      text: "@6285155247688 /deinit-session",
    });

    expect(decision.type).toBe("reply");
    if (decision.type === "reply") {
      expect(decision.text).toContain("session paused");
    }
  });
});
