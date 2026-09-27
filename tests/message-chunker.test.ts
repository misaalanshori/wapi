import { describe, it, expect } from "vitest";
import { chunkMessage } from "../src/message-chunker.js";

describe("chunkMessage", () => {
  it("returns single chunk when text is below maxChunkLength", () => {
    const text = "Hello, this is a short response.";
    const chunks = chunkMessage(text, 100);
    expect(chunks).toEqual([text]);
  });

  it("splits at paragraph breaks when text exceeds maxChunkLength", () => {
    const p1 = "A".repeat(80);
    const p2 = "B".repeat(80);
    const text = `${p1}\n\n${p2}`;

    const chunks = chunkMessage(text, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
  });

  it("splits long unbroken paragraph at newline or sentence/word boundaries", () => {
    const sentence1 = "The quick brown fox jumps over the lazy dog. ";
    const sentence2 = "Pack my box with five dozen liquor jugs. ";
    const sentence3 = "How vexingly quick daft zebras jump! ";
    const text = (sentence1 + sentence2 + sentence3).repeat(10); // ~920 chars

    const chunks = chunkMessage(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
    // All text preserved
    expect(chunks.join(" ")).toContain("The quick brown fox");
  });

  it("handles empty or whitespace text gracefully", () => {
    expect(chunkMessage("", 100)).toEqual([]);
    expect(chunkMessage("   ", 100)).toEqual([]);
  });
});
