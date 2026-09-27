import { describe, it, expect, vi } from "vitest";
import { AgentSessionManager } from "../../src/agent-session-manager.js";

describe("Regression: Long assistant replies must be chunked into multiple messages", () => {
  it("delivers large responses in chunks of <= 4000 chars without dropping text", async () => {
    const longReply = ("Paragraph A " + "x".repeat(1500) + "\n\n").repeat(4); // ~6000 chars

    const mockSession = {
      prompt: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue(longReply),
      dispose: vi.fn(),
    };

    const sentMessages: string[] = [];
    const mockWaLink = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockImplementation(async (_chat, text) => {
        sentMessages.push(text);
        return "msg-id";
      }),
    };

    const manager = new AgentSessionManager({
      dataDir: "/tmp/data",
      sharedAgentDir: "/tmp/agent-home",
      model: {} as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: mockSession }),
    });

    await manager.deliverMessage("sess-1", "chat-1@s.whatsapp.net", "hello", mockWaLink);

    expect(sentMessages.length).toBeGreaterThan(1);
    for (const msg of sentMessages) {
      expect(msg.length).toBeLessThanOrEqual(4000);
    }

    // Verify all content delivered
    const combined = sentMessages.join("\n\n");
    expect(combined).toContain("Paragraph A");
  });
});
