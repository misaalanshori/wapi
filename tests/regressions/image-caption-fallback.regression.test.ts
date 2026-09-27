import { describe, it, expect, vi } from "vitest";
import { AgentSessionManager } from "../../src/agent-session-manager.js";

describe("Regression: Image with empty caption defaults to non-empty prompt", () => {
  it("delivers default prompt '[User sent an image]' when caption is empty string", async () => {
    let capturedPrompt = "";
    const mockSession = {
      prompt: vi.fn().mockImplementation(async (text) => {
        capturedPrompt = text;
      }),
      getLastAssistantText: vi.fn().mockReturnValue("Received image."),
      dispose: vi.fn(),
    };

    const mockWaLink = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("msg-1"),
    };

    const manager = new AgentSessionManager({
      dataDir: "/tmp/data",
      sharedAgentDir: "/tmp/agent-home",
      model: {} as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: mockSession }),
    });

    const caption = "   ";
    const promptText = caption.trim().length === 0 ? "[User sent an image]" : caption;

    await manager.deliverMessage(
      "sess-1",
      "chat-1@s.whatsapp.net",
      promptText,
      mockWaLink,
      [{ type: "image", data: "base64", mimeType: "image/jpeg" }]
    );

    expect(capturedPrompt).toBe("[User sent an image]");
  });
});
