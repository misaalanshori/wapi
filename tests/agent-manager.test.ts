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
});
