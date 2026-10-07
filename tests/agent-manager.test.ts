import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSessionManager } from "../src/agent-session-manager.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("AgentSessionManager", () => {
  let tmpDir: string;
  let mockWaLink: any;
  let mockAgentSession: any;
  let mockSessionFactory: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-test-"));
    mockWaLink = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("out-msg-1"),
    };
    mockAgentSession = {
      prompt: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("Hello, this is Pi assistant!"),
      dispose: vi.fn(),
    };
    mockSessionFactory = vi.fn().mockResolvedValue({ session: mockAgentSession });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("checks whether session folder exists on disk", async () => {
    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: {} as any,
      modelRuntime: {} as any,
      sessionFactory: mockSessionFactory,
    });

    expect(await manager.sessionExistsOnDisk("unknown-uuid")).toBe(false);

    // Create session folder
    const sessionDir = path.join(tmpDir, "sessions", "uuid-123");
    await fs.mkdir(sessionDir, { recursive: true });

    expect(await manager.sessionExistsOnDisk("uuid-123")).toBe(true);
  });

  it("writes keepRecentTokens to sharedAgentDir settings.json based on compactionConfig", async () => {
    const sharedAgentDir = path.join(tmpDir, "agent-home");
    new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir,
      model: {} as any,
      modelRuntime: {} as any,
      sessionFactory: mockSessionFactory,
      compactionConfig: {
        softLimitTokens: 150000,
        idleMinutes: 15,
        targetTokens: 80000,
        headRatio: 1,
        tailRatio: 3,
      },
    });

    // Wait a brief tick for async file write
    await new Promise((r) => setTimeout(r, 20));

    const settingsRaw = await fs.readFile(path.join(sharedAgentDir, "settings.json"), "utf8");
    const settings = JSON.parse(settingsRaw);
    expect(settings.compaction.keepRecentTokens).toBe(60000); // 80k * (3 / 4)
  });

  it("creates session directory structure and initializes agent session", async () => {
    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: mockSessionFactory,
    });

    const sessionId = "uuid-test-create";
    const chatJid = "chat-123@s.whatsapp.net";

    const session = await manager.getOrCreateSession(sessionId, chatJid);
    expect(session).toBe(mockAgentSession);
    expect(mockSessionFactory).toHaveBeenCalledTimes(1);
    expect(mockSessionFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining(["sqlite_storage", "schedule"]),
      })
    );

    // Verify directory and meta.json created
    const sessionDir = path.join(tmpDir, "sessions", sessionId);
    const metaExists = await fs
      .access(path.join(sessionDir, "meta.json"))
      .then(() => true)
      .catch(() => false);
    expect(metaExists).toBe(true);

    const meta = JSON.parse(await fs.readFile(path.join(sessionDir, "meta.json"), "utf8"));
    expect(meta.sessionId).toBe(sessionId);
    expect(meta.chatJid).toBe(chatJid);

    // Second call for same sessionId should reuse cached session
    const session2 = await manager.getOrCreateSession(sessionId, chatJid);
    expect(session2).toBe(mockAgentSession);
    expect(mockSessionFactory).toHaveBeenCalledTimes(1);
  });

  it("re-opens and continues existing session across restarts without creating a new session file", async () => {
    const sessionId = "uuid-persistence-check";
    const chatJid = "chat-persist@s.whatsapp.net";

    let capturedSessionManager1: any;
    let capturedSessionManager2: any;

    const factory1 = vi.fn().mockImplementation(async (opts) => {
      capturedSessionManager1 = opts.sessionManager;
      opts.sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "Turn 1" }] });
      opts.sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Reply 1" }] });
      return { session: mockAgentSession };
    });

    const manager1 = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: factory1,
    });

    await manager1.getOrCreateSession(sessionId, chatJid);
    const sessionFile1 = capturedSessionManager1.getSessionFile();
    expect(sessionFile1).toBeDefined();

    // Now simulate manager restart (new manager instance with empty in-memory cache)
    const factory2 = vi.fn().mockImplementation(async (opts) => {
      capturedSessionManager2 = opts.sessionManager;
      return { session: mockAgentSession };
    });

    const manager2 = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: factory2,
    });

    await manager2.getOrCreateSession(sessionId, chatJid);
    const sessionFile2 = capturedSessionManager2.getSessionFile();

    // MUST continue the exact same session file, not create a new one!
    expect(sessionFile2).toBe(sessionFile1);
    expect(capturedSessionManager2.getEntries().length).toBeGreaterThan(0);
  });

  it("formats session status summary using Pi session stats and context usage", async () => {
    const mockStatsSession: any = {
      getSessionStats: vi.fn().mockReturnValue({
        totalMessages: 10,
        userMessages: 4,
        assistantMessages: 6,
        toolCalls: 3,
        toolResults: 3,
        tokens: { input: 5000, output: 1000, cacheRead: 4000, cacheWrite: 0, total: 6000 },
        cost: 0.0025,
      }),
      getContextUsage: vi.fn().mockReturnValue({
        tokens: 3500,
        contextWindow: 1000000,
        percent: 0.35,
      }),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "deepseek-v4.1-flash", provider: "opencode-go" } as any,
      modelRuntime: {} as any,
      tz: "Asia/Jakarta",
      sessionFactory: vi.fn().mockResolvedValue({ session: mockStatsSession }),
    });

    const summary = await manager.getSessionStatusSummary("sess-summary-1", "chat-summary@g.us");
    expect(summary).toContain("*Session Info*");
    expect(summary).toContain("sess-summary-1");
    expect(summary).toContain("opencode-go/deepseek-v4.1-flash");
    expect(summary).toContain("Asia/Jakarta");
    expect(summary).toContain("Total: 10");
    expect(summary).toContain("Active Context: 3,500 / 1,000,000 tokens (0.35%)");
    expect(summary).toContain("Estimated Cost: $0.0025");
  });

  it("delivers text to agent session, sends composing presence, and sends reply", async () => {
    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: mockSessionFactory,
    });

    const sessionId = "uuid-deliver";
    const chatJid = "chat-deliver@s.whatsapp.net";

    await manager.deliverMessage(sessionId, chatJid, "What can you do?", mockWaLink);

    expect(mockWaLink.sendPresenceUpdate).toHaveBeenCalledWith(chatJid, "composing");
    expect(mockAgentSession.prompt).toHaveBeenCalledWith("What can you do?", {
      streamingBehavior: "followUp",
    });
    expect(mockWaLink.sendMessage).toHaveBeenCalledWith(chatJid, "Hello, this is Pi assistant!");
    expect(mockWaLink.sendPresenceUpdate).toHaveBeenCalledWith(chatJid, "paused");
  });

  it("disposes session and removes it from active map", async () => {
    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: mockSessionFactory,
    });

    const sessionId = "uuid-dispose";
    await manager.getOrCreateSession(sessionId, "chat@s.whatsapp.net");

    await manager.disposeSession(sessionId);
    expect(mockAgentSession.dispose).toHaveBeenCalled();

    // Calling again should invoke factory again
    await manager.getOrCreateSession(sessionId, "chat@s.whatsapp.net");
    expect(mockSessionFactory).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent messages for the same session in FIFO order", async () => {
    const executionOrder: string[] = [];
    const sessionMock: any = {
      prompt: vi.fn(async (text: string) => {
        executionOrder.push(`start-${text}`);
        await new Promise((r) => setTimeout(r, 20));
        executionOrder.push(`end-${text}`);
      }),
      getLastAssistantText: vi.fn().mockReturnValue("Done"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    const sessionId = "uuid-queue-test";
    const chatJid = "chat-queue@s.whatsapp.net";

    // Launch two concurrent deliverMessage calls for the same session
    const p1 = manager.deliverMessage(sessionId, chatJid, "msg-1", mockWaLink);
    const p2 = manager.deliverMessage(sessionId, chatJid, "msg-2", mockWaLink);

    await Promise.all([p1, p2]);

    expect(executionOrder).toEqual([
      "start-msg-1",
      "end-msg-1",
      "start-msg-2",
      "end-msg-2",
    ]);
  });

  it("repeats presence update heartbeat while long prompt is executing", async () => {
    let promptResolve: () => void;
    const promptPromise = new Promise<void>((r) => {
      promptResolve = r;
    });

    const sessionMock: any = {
      prompt: vi.fn(async () => {
        await promptPromise;
      }),
      getLastAssistantText: vi.fn().mockReturnValue("Finished long task"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model", provider: "mock" } as any,
      modelRuntime: {} as any,
      presenceHeartbeatMs: 25,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    const chatJid = "chat-heartbeat@s.whatsapp.net";
    const deliverPromise = manager.deliverMessage("uuid-hb", chatJid, "Long query", mockWaLink);

    // Wait for at least 2 heartbeat cycles (60ms)
    await new Promise((r) => setTimeout(r, 65));
    expect(mockWaLink.sendPresenceUpdate).toHaveBeenCalledWith(chatJid, "composing");
    expect(mockWaLink.sendPresenceUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);

    promptResolve!();
    await deliverPromise;

    expect(mockWaLink.sendPresenceUpdate).toHaveBeenLastCalledWith(chatJid, "paused");
  });

  it("switches to fallback model when primary prompt fails and succeeds on retry", async () => {
    let callCount = 0;
    const primaryModel = { id: "primary", provider: "mock" };
    const fallbackModel = { id: "fallback", provider: "mock" };

    const sessionMock: any = {
      prompt: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Primary model rate limited / 503");
        }
      }),
      setModel: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("Recovered with fallback"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: primaryModel as any,
      fallbackModel: fallbackModel as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    const reply = await manager.deliverMessage(
      "uuid-fallback-test",
      "chat-fallback@s.whatsapp.net",
      "hello",
      mockWaLink
    );

    expect(sessionMock.setModel).toHaveBeenCalledWith(fallbackModel);
    expect(callCount).toBe(2);
    expect(reply).toBe("Recovered with fallback");
  });

  it("attempts to revert to primary model after idle period elapses", async () => {
    const primaryModel = { id: "primary", provider: "mock" };
    const fallbackModel = { id: "fallback", provider: "mock" };

    let promptCount = 0;
    const sessionMock: any = {
      prompt: vi.fn(async () => {
        promptCount++;
        if (promptCount === 1) {
          throw new Error("Temporary outage");
        }
      }),
      setModel: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("Reply ok"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: primaryModel as any,
      fallbackModel: fallbackModel as any,
      fallbackCheckIdleMs: 50, // 50ms for test
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    // 1. Initial turn fails on primary -> switches to fallback
    await manager.deliverMessage("uuid-revert-test", "chat@s.whatsapp.net", "query 1", mockWaLink);
    expect(sessionMock.setModel).toHaveBeenCalledWith(fallbackModel);

    // 2. Immediate next message within 50ms stays on fallback
    await manager.deliverMessage("uuid-revert-test", "chat@s.whatsapp.net", "query 2", mockWaLink);
    expect(sessionMock.setModel).toHaveBeenCalledTimes(1);

    // 3. Wait for idle period to elapse (>50ms)
    await new Promise((r) => setTimeout(r, 60));

    // 4. Next message reverts back to primary model
    await manager.deliverMessage("uuid-revert-test", "chat@s.whatsapp.net", "query 3", mockWaLink);
    expect(sessionMock.setModel).toHaveBeenCalledWith(primaryModel);
  });

  it("steers active streaming turn via session.steer()", async () => {
    const sessionMock: any = {
      isStreaming: true,
      steer: vi.fn().mockResolvedValue("queued"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    await manager.getOrCreateSession("sess-steer", "chat@s.whatsapp.net");

    const steered = await manager.steerSession(
      "sess-steer",
      "chat@s.whatsapp.net",
      "stop right now",
      mockWaLink
    );

    expect(steered).toBe(true);
    expect(sessionMock.steer).toHaveBeenCalledWith("stop right now");
  });

  it("delivers prompt normally when session is not streaming during steer command", async () => {
    const sessionMock: any = {
      isStreaming: false,
      prompt: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("Prompt response"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    await manager.getOrCreateSession("sess-idle-steer", "chat@s.whatsapp.net");

    const steered = await manager.steerSession(
      "sess-idle-steer",
      "chat@s.whatsapp.net",
      "do this instead",
      mockWaLink
    );

    expect(steered).toBe(false);
  });
});
