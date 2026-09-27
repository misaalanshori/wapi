import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isMessageAddressed } from "../src/addressing-gate.js";
import { SessionRegistry } from "../src/session-registry.js";
import { SessionGatekeeper } from "../src/session-gatekeeper.js";
import { AgentSessionManager } from "../src/agent-session-manager.js";
import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Core Loop Integration (Addressing Gate + Gatekeeper + Agent Manager)", () => {
  let tmpDir: string;
  let db: Database.Database;
  let registry: SessionRegistry;
  let agentManager: AgentSessionManager;
  let gatekeeper: SessionGatekeeper;
  let mockWaLink: any;
  let mockAgentSession: any;

  const SECRET = "supersecret99";
  const BOT_JID = "bot@s.whatsapp.net";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-core-loop-"));
    db = new Database(":memory:");
    registry = new SessionRegistry(db);

    mockWaLink = {
      sendMessage: vi.fn().mockResolvedValue("out-123"),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    };

    mockAgentSession = {
      prompt: vi.fn().mockImplementation(async (text: string) => {
        // Mock LLM answer
        lastPrompt = text;
      }),
      getLastAssistantText: vi.fn().mockImplementation(() => `Echo: ${lastPrompt}`),
      dispose: vi.fn(),
    };
    let lastPrompt = "";

    agentManager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: mockAgentSession }),
    });

    gatekeeper = new SessionGatekeeper({
      secretWord: SECRET,
      registry,
      sessionExistsOnDisk: (uuid) => agentManager.sessionExistsOnDisk(uuid),
      onSessionPaused: (id) => agentManager.disposeSession(id),
    });
  });

  afterEach(async () => {
    await agentManager.disposeAll();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function processIncoming(msg: {
    chatJid: string;
    senderJid: string;
    isGroup: boolean;
    participantCount: number;
    mentionedJids: string[];
    text: string;
  }) {
    // 1. Addressing gate
    const addressed = isMessageAddressed({
      chatJid: msg.chatJid,
      isGroup: msg.isGroup,
      participantCount: msg.participantCount,
      mentionedJids: msg.mentionedJids,
      botJid: BOT_JID,
    });

    if (!addressed) {
      return { handled: false, reason: "not_addressed" };
    }

    // 2. Session Gatekeeper
    const decision = await gatekeeper.handleMessage({
      chatJid: msg.chatJid,
      senderJid: msg.senderJid,
      text: msg.text,
    });

    if (decision.type === "drop") {
      return { handled: false, reason: "dropped" };
    }

    if (decision.type === "reply") {
      await mockWaLink.sendMessage(msg.chatJid, decision.text);
      return { handled: true, type: "reply", text: decision.text, sessionId: decision.sessionId };
    }

    // 3. Forward to agent
    const reply = await agentManager.deliverMessage(
      decision.sessionId,
      msg.chatJid,
      decision.text,
      mockWaLink
    );
    return { handled: true, type: "agent_reply", text: reply, sessionId: decision.sessionId };
  }

  it("completes full lifecycle: unaddressed drop -> init -> prompt -> deinit -> resume", async () => {
    const groupJid = "group-1@g.us";

    // 1. Message in group without mention -> unaddressed drop
    const r1 = await processIncoming({
      chatJid: groupJid,
      senderJid: "user1@s.whatsapp.net",
      isGroup: true,
      participantCount: 5,
      mentionedJids: [],
      text: `/init-session ${SECRET}`,
    });
    expect(r1.handled).toBe(false);
    expect(r1.reason).toBe("not_addressed");

    // 2. Mentioned in group, but wrong secret -> dropped silently
    const r2 = await processIncoming({
      chatJid: groupJid,
      senderJid: "user1@s.whatsapp.net",
      isGroup: true,
      participantCount: 5,
      mentionedJids: [BOT_JID],
      text: `/init-session wrongword`,
    });
    expect(r2.handled).toBe(false);
    expect(r2.reason).toBe("dropped");

    // 3. Mentioned in group with correct secret -> session initialized!
    const r3 = await processIncoming({
      chatJid: groupJid,
      senderJid: "user1@s.whatsapp.net",
      isGroup: true,
      participantCount: 5,
      mentionedJids: [BOT_JID],
      text: `/init-session ${SECRET}`,
    });
    expect(r3.handled).toBe(true);
    expect(r3.type).toBe("reply");
    expect(r3.text).toContain("session started");
    const sessionId = (r3 as any).sessionId;
    expect(sessionId).toBeDefined();

    // 4. Send ordinary conversation prompt -> handled by agent
    const r4 = await processIncoming({
      chatJid: groupJid,
      senderJid: "user1@s.whatsapp.net",
      isGroup: true,
      participantCount: 5,
      mentionedJids: [BOT_JID],
      text: "Can you help me organize my notes?",
    });
    expect(r4.handled).toBe(true);
    expect(r4.type).toBe("agent_reply");
    expect(r4.text).toContain("Echo: Can you help me organize my notes?");

    // 5. Send /deinit-session -> pauses session
    const r5 = await processIncoming({
      chatJid: groupJid,
      senderJid: "user1@s.whatsapp.net",
      isGroup: true,
      participantCount: 5,
      mentionedJids: [BOT_JID],
      text: "/deinit-session",
    });
    expect(r5.handled).toBe(true);
    expect(r5.text).toContain("session paused");

    // 6. Next ordinary message in paused chat -> dropped silently
    const r6 = await processIncoming({
      chatJid: groupJid,
      senderJid: "user1@s.whatsapp.net",
      isGroup: true,
      participantCount: 5,
      mentionedJids: [BOT_JID],
      text: "Are you still there?",
    });
    expect(r6.handled).toBe(false);
    expect(r6.reason).toBe("dropped");

    // 7. Resume in a DM chat using the session UUID
    const dmJid = "user1@s.whatsapp.net";
    const r7 = await processIncoming({
      chatJid: dmJid,
      senderJid: dmJid,
      isGroup: false,
      participantCount: 2,
      mentionedJids: [],
      text: `/init-session ${SECRET} ${sessionId}`,
    });
    expect(r7.handled).toBe(true);
    expect(r7.type).toBe("reply");
    expect(r7.text).toContain("session resumed");

    // 8. Normal message in resumed DM chat -> handled by agent!
    const r8 = await processIncoming({
      chatJid: dmJid,
      senderJid: dmJid,
      isGroup: false,
      participantCount: 2,
      mentionedJids: [],
      text: "Continuing our conversation in DM",
    });
    expect(r8.handled).toBe(true);
    expect(r8.type).toBe("agent_reply");
    expect(r8.text).toContain("Echo: Continuing our conversation in DM");
  });
});
