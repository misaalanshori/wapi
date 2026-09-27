import { describe, it, expect } from "vitest";
import { ChatHistoryBuffer } from "../src/chat-history-buffer.js";

describe("ChatHistoryBuffer", () => {
  it("stores and retrieves bounded messages per chatJid", () => {
    const buffer = new ChatHistoryBuffer(3);

    buffer.push("chat-1", { senderName: "Alice", senderPhone: "+1", text: "msg 1" });
    buffer.push("chat-1", { senderName: "Bob", senderPhone: "+2", text: "msg 2" });
    buffer.push("chat-1", { senderName: "Charlie", senderPhone: "+3", text: "msg 3" });
    buffer.push("chat-1", { senderName: "Dave", senderPhone: "+4", text: "msg 4" });

    // Should only keep last 3 messages (msg 2, msg 3, msg 4)
    const formatted = buffer.flushFormattedContext("chat-1");
    expect(formatted).toBeDefined();
    expect(formatted).toContain("Bob (+2): msg 2");
    expect(formatted).toContain("Charlie (+3): msg 3");
    expect(formatted).toContain("Dave (+4): msg 4");
    expect(formatted).not.toContain("msg 1");

    // Flushing should clear the buffer
    expect(buffer.flushFormattedContext("chat-1")).toBeUndefined();
  });

  it("returns undefined when no ambient messages exist", () => {
    const buffer = new ChatHistoryBuffer(10);
    expect(buffer.flushFormattedContext("empty-chat")).toBeUndefined();
  });

  it("truncates long ambient messages to max 200 chars", () => {
    const buffer = new ChatHistoryBuffer(5);
    const longMsg = "A".repeat(300);
    buffer.push("chat-2", { senderName: "Alice", text: longMsg });

    const formatted = buffer.flushFormattedContext("chat-2");
    expect(formatted).toBeDefined();
    expect(formatted).toContain("A".repeat(197) + "...");
  });
});
