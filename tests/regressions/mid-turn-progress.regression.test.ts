import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSessionManager } from "../../src/agent-session-manager.js";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Mid-Turn Progress Streaming Regression Suite", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `test-reg-midturn-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("streams and edits progress message on multi-step turns, sending final reply separately", async () => {
    let subscriberCb: any;
    const sessionMock: any = {
      subscribe: vi.fn((cb) => {
        subscriberCb = cb;
        return () => {};
      }),
      prompt: vi.fn(async () => {
        // Step 1: Tool call
        await subscriberCb({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [
              { type: "text", text: "I will query SQLite" },
              { type: "toolCall", name: "sqlite_storage", arguments: { action: "schema" } },
            ],
          },
        });

        // Step 2: Second tool call
        await subscriberCb({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [
              { type: "text", text: "Now checking files" },
              { type: "toolCall", name: "bash", arguments: { command: "ls -la" } },
            ],
          },
        });
      }),
      getLastAssistantText: vi.fn().mockReturnValue("Here is the final result."),
      dispose: vi.fn(),
    };

    const senderMock = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("prog-msg-id-1"),
      editMessage: vi.fn().mockResolvedValue("prog-msg-id-1"),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test", provider: "mock" } as any,
      modelRuntime: {} as any,
      progressMinSteps: 0,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    const reply = await manager.deliverMessage("sess-reg-midturn", "chat@g.us", "inspect", senderMock);
    expect(reply).toBe("Here is the final result.");

    // Initial message sent
    expect(senderMock.sendMessage).toHaveBeenCalledWith(
      "chat@g.us",
      expect.stringContaining("I will query SQLite")
    );

    // Edited in-place for step 2
    expect(senderMock.editMessage).toHaveBeenCalledWith(
      "chat@g.us",
      { remoteJid: "chat@g.us", id: "prog-msg-id-1", fromMe: true },
      expect.stringContaining("Now checking files")
    );

    // Edited in-place upon completion
    expect(senderMock.editMessage).toHaveBeenCalledWith(
      "chat@g.us",
      { remoteJid: "chat@g.us", id: "prog-msg-id-1", fromMe: true },
      expect.stringContaining("Completed")
    );

    // Final answer sent as clean separate message
    expect(senderMock.sendMessage).toHaveBeenCalledWith("chat@g.us", "Here is the final result.");
  });

  it("does not create a progress bubble when a turn has zero tool calls", async () => {
    let subscriberCb: any;
    const sessionMock: any = {
      subscribe: vi.fn((cb) => {
        subscriberCb = cb;
        return () => {};
      }),
      prompt: vi.fn(async () => {
        // Direct stop without tool calls
        await subscriberCb({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: "Direct greeting" }],
          },
        });
      }),
      getLastAssistantText: vi.fn().mockReturnValue("Direct greeting"),
      dispose: vi.fn(),
    };

    const senderMock = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("direct-msg-id"),
      editMessage: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: sessionMock }),
    });

    const reply = await manager.deliverMessage("sess-no-tools", "chat@g.us", "hi", senderMock);
    expect(reply).toBe("Direct greeting");
    expect(senderMock.editMessage).not.toHaveBeenCalled();
    expect(senderMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(senderMock.sendMessage).toHaveBeenCalledWith("chat@g.us", "Direct greeting");
  });
});
