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
});
