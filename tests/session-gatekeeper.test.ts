import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionGatekeeper } from "../src/session-gatekeeper.js";
import { SessionRegistry } from "../src/session-registry.js";
import Database from "better-sqlite3";

describe("SessionGatekeeper", () => {
  let db: Database.Database;
  let registry: SessionRegistry;
  let gatekeeper: SessionGatekeeper;
  let mockSessionExists: (uuid: string) => boolean;

  const SECRET = "secretword9330";

  beforeEach(() => {
    db = new Database(":memory:");
    registry = new SessionRegistry(db);
    mockSessionExists = vi.fn().mockImplementation((uuid: string) => uuid === "11112222-3333-4444-a555-666677778888");

    gatekeeper = new SessionGatekeeper({
      secretWord: SECRET,
      registry,
      sessionExistsOnDisk: mockSessionExists,
    });
  });

  describe("Uninitialized chat", () => {
    const chatJid = "chat-new@s.whatsapp.net";

    it("silently drops ordinary messages", async () => {
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: "Hello assistant?",
      });
      expect(decision.type).toBe("drop");
    });

    it("silently drops /init-session with wrong secret", async () => {
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: "/init-session wrongpassword",
      });
      expect(decision.type).toBe("drop");
    });

    it("silently drops /init-session with no arguments", async () => {
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: "/init-session",
      });
      expect(decision.type).toBe("drop");
    });

    it("creates a new session when /init-session has correct secret and no UUID", async () => {
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: `/init-session ${SECRET}`,
      });

      expect(decision.type).toBe("reply");
      if (decision.type === "reply") {
        expect(decision.text).toContain("session started");
        expect(decision.sessionId).toBeDefined();
      }

      const active = registry.findActiveByChatJid(chatJid);
      expect(active).not.toBeNull();
    });

    it("silently drops /init-session when UUID is provided but does not exist on disk", async () => {
      const nonexistentUuid = "00000000-0000-0000-0000-000000000000";
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: `/init-session ${SECRET} ${nonexistentUuid}`,
      });
      expect(decision.type).toBe("drop");
    });

    it("resumes session when UUID is provided and exists on disk", async () => {
      const validUuid = "11112222-3333-4444-a555-666677778888";
      // First insert an initial paused session record in registry
      registry.createSession(validUuid, "old-chat@s.whatsapp.net");
      registry.pauseSession(validUuid);

      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: `/init-session ${SECRET} ${validUuid}`,
      });

      expect(decision.type).toBe("reply");
      if (decision.type === "reply") {
        expect(decision.text).toContain("resumed");
        expect(decision.sessionId).toBe(validUuid);
      }

      const active = registry.findActiveByChatJid(chatJid);
      expect(active?.id).toBe(validUuid);
    });
  });

  describe("Active chat", () => {
    const chatJid = "chat-active@s.whatsapp.net";
    const sessionId = "active-uuid-1234-5678-9012-345678901234";

    beforeEach(() => {
      registry.createSession(sessionId, chatJid);
    });

    it("pauses session when receiving /deinit-session", async () => {
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: "/deinit-session",
      });

      expect(decision.type).toBe("reply");
      if (decision.type === "reply") {
        expect(decision.text).toContain("session paused");
        expect(decision.text).toContain(sessionId);
      }

      expect(registry.findActiveByChatJid(chatJid)).toBeNull();
      expect(registry.findById(sessionId)?.status).toBe("paused");
    });

    it("replies that session is already active if /init-session is sent", async () => {
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: `/init-session ${SECRET}`,
      });

      expect(decision.type).toBe("reply");
      if (decision.type === "reply") {
        expect(decision.text).toContain("already active");
        expect(decision.text).toContain(sessionId);
      }
    });

    it("returns formatted session status when receiving /session", async () => {
      const mockStatusHandler = vi.fn().mockResolvedValue("*Session Status*\n• ID: test-session");
      const gk = new SessionGatekeeper({
        secretWord: SECRET,
        registry,
        sessionExistsOnDisk: () => true,
        onSessionStatus: mockStatusHandler,
      });

      const decision = await gk.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: "/session",
      });

      expect(decision.type).toBe("reply");
      if (decision.type === "reply") {
        expect(decision.text).toContain("*Session Status*");
      }
      expect(mockStatusHandler).toHaveBeenCalledWith(sessionId, chatJid);
    });

    it("forwards normal messages to the agent", async () => {
      const decision = await gatekeeper.handleMessage({
        chatJid,
        senderJid: "user@s.whatsapp.net",
        text: "What is the weather today?",
      });

      expect(decision.type).toBe("forward");
      if (decision.type === "forward") {
        expect(decision.sessionId).toBe(sessionId);
        expect(decision.text).toBe("What is the weather today?");
      }
    });
  });
});
