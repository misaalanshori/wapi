import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionGatekeeper } from "../../src/session-gatekeeper.js";
import { SessionRegistry } from "../../src/session-registry.js";
import { AgentSessionManager } from "../../src/agent-session-manager.js";
import Database from "better-sqlite3";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Steering Capabilities Regression Suite", () => {
  let tmpDir: string;
  let db: Database.Database;
  let registry: SessionRegistry;
  let gatekeeper: SessionGatekeeper;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `test-reg-steer-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    db = new Database(path.join(tmpDir, "registry.sqlite"));
    registry = new SessionRegistry(db);
    gatekeeper = new SessionGatekeeper({
      secretWord: "secret-word",
      registry,
      sessionExistsOnDisk: () => true,
    });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("gatekeeper handles /steer and @bot /steer commands in active session", async () => {
    const sessionId = "sess-steer-test";
    const chatJid = "chat-steer@g.us";
    registry.createSession(sessionId, chatJid);

    // 1. Direct /steer
    const dec1 = await gatekeeper.handleMessage({
      chatJid,
      senderJid: "user@s.whatsapp.net",
      text: "/steer you can stop now and summarize",
    });
    expect(dec1.type).toBe("steer");
    if (dec1.type === "steer") {
      expect(dec1.text).toBe("you can stop now and summarize");
    }

    // 2. Tagged @bot /steer
    const dec2 = await gatekeeper.handleMessage({
      chatJid,
      senderJid: "user@s.whatsapp.net",
      text: "@bot /steer finish the current task",
    });
    expect(dec2.type).toBe("steer");
    if (dec2.type === "steer") {
      expect(dec2.text).toBe("finish the current task");
    }

    // 3. Empty /steer gives helpful usage instructions
    const dec3 = await gatekeeper.handleMessage({
      chatJid,
      senderJid: "user@s.whatsapp.net",
      text: "/steer",
    });
    expect(dec3.type).toBe("reply");
    if (dec3.type === "reply") {
      expect(dec3.text).toContain("Please provide steering instructions");
    }
  });

  it("steerSession injects steering immediately into active streaming turn", async () => {
    const mockSession: any = {
      isStreaming: true,
      steer: vi.fn().mockResolvedValue("queued"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: mockSession }),
    });

    await manager.getOrCreateSession("sess-active", "chat@g.us");

    const senderMock = {
      sendPresenceUpdate: vi.fn(),
      sendMessage: vi.fn(),
    };

    const steered = await manager.steerSession(
      "sess-active",
      "chat@g.us",
      "stop researching and answer immediately",
      senderMock
    );

    expect(steered).toBe(true);
    expect(mockSession.steer).toHaveBeenCalledWith("stop researching and answer immediately");
  });
});
