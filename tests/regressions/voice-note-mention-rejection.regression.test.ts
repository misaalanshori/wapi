import { describe, it, expect, beforeEach } from "vitest";
import { isMessageAddressed } from "../../src/addressing-gate.js";
import { SessionGatekeeper } from "../../src/session-gatekeeper.js";
import { SessionRegistry } from "../../src/session-registry.js";
import Database from "better-sqlite3";

describe("Regression: Voice note in group chat with bot tag triggers polite refusal", () => {
  let db: Database.Database;
  let registry: SessionRegistry;
  let gatekeeper: SessionGatekeeper;

  const BOT_JID = "1234567890@s.whatsapp.net";

  beforeEach(() => {
    db = new Database(":memory:");
    registry = new SessionRegistry(db);
    registry.createSession("uuid-group-voice", "12345-67890@g.us");

    gatekeeper = new SessionGatekeeper({
      secretWord: "secret123",
      registry,
      sessionExistsOnDisk: () => true,
    });
  });

  it("checks addressing and returns polite refusal for audio in active group", async () => {
    // 1. Addressing gate check
    const addressed = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 5,
      mentionedJids: [BOT_JID],
      botJid: BOT_JID,
    });
    expect(addressed).toBe(true);

    // 2. Gatekeeper handling
    const decision = await gatekeeper.handleMessage({
      chatJid: "12345-67890@g.us",
      senderJid: "user1@s.whatsapp.net",
      text: "",
      kind: "audio",
    });

    expect(decision.type).toBe("reply");
    if (decision.type === "reply") {
      expect(decision.text).toContain("cannot understand audio or voice notes yet");
    }
  });
});
