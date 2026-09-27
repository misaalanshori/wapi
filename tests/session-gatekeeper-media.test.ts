import { describe, it, expect, beforeEach } from "vitest";
import { SessionGatekeeper } from "../src/session-gatekeeper.js";
import { SessionRegistry } from "../src/session-registry.js";
import Database from "better-sqlite3";

describe("SessionGatekeeper Media Handling", () => {
  let db: Database.Database;
  let registry: SessionRegistry;
  let gatekeeper: SessionGatekeeper;

  const SECRET = "secretword123";

  beforeEach(() => {
    db = new Database(":memory:");
    registry = new SessionRegistry(db);
    gatekeeper = new SessionGatekeeper({
      secretWord: SECRET,
      registry,
      sessionExistsOnDisk: () => true,
    });
  });

  it("silently drops audio messages in uninitialized chats", async () => {
    const decision = await gatekeeper.handleMessage({
      chatJid: "uninit@s.whatsapp.net",
      senderJid: "user@s.whatsapp.net",
      text: "",
      kind: "audio",
    });

    expect(decision.type).toBe("drop");
  });

  it("replies with polite refusal when audio message is received in active chat", async () => {
    registry.createSession("uuid-active", "active@s.whatsapp.net");

    const decision = await gatekeeper.handleMessage({
      chatJid: "active@s.whatsapp.net",
      senderJid: "user@s.whatsapp.net",
      text: "",
      kind: "audio",
    });

    expect(decision.type).toBe("reply");
    if (decision.type === "reply") {
      expect(decision.text).toContain("cannot understand audio or voice notes yet");
    }
  });

  it("forwards image messages in active chats to the agent", async () => {
    registry.createSession("uuid-active", "active@s.whatsapp.net");

    const decision = await gatekeeper.handleMessage({
      chatJid: "active@s.whatsapp.net",
      senderJid: "user@s.whatsapp.net",
      text: "Describe this image",
      kind: "image",
    });

    expect(decision.type).toBe("forward");
    if (decision.type === "forward") {
      expect(decision.sessionId).toBe("uuid-active");
      expect(decision.text).toBe("Describe this image");
      expect(decision.kind).toBe("image");
    }
  });

  it("silently drops image in uninitialized chat without secret init command in caption", async () => {
    const decision = await gatekeeper.handleMessage({
      chatJid: "uninit@s.whatsapp.net",
      senderJid: "user@s.whatsapp.net",
      text: "Just an image caption",
      kind: "image",
    });

    expect(decision.type).toBe("drop");
  });
});
