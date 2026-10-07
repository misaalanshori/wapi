import { describe, it, expect, vi } from "vitest";
import { formatUserPromptWithAttribution } from "../../src/message-extractor.js";

describe("Image Pipeline Regression Suite", () => {
  it("formats prompt with explicit attached image notice and file path", () => {
    const promptText = '[Attached Image: "photo-123.jpg" saved at "/data/sessions/sess-1/media/photo-123.jpg"]\nWhat is this?';
    const formatted = formatUserPromptWithAttribution({
      text: promptText,
      senderName: "M Isa",
      senderPhone: "+6283820039330",
      isGroup: true,
      groupSubject: "PT WOKEUPLAIKDIS",
    });

    expect(formatted).toContain('[Attached Image: "photo-123.jpg" saved at "/data/sessions/sess-1/media/photo-123.jpg"]');
    expect(formatted).toContain("What is this?");
  });

  it("formats prompt when quoting an image with explicit quoted image notice", () => {
    const promptText = '[Quoted Image: "target-456.jpg" saved at "/data/sessions/sess-1/media/target-456.jpg"]\nexplain this photo';
    const formatted = formatUserPromptWithAttribution({
      text: promptText,
      senderName: "M Isa",
      senderPhone: "+6283820039330",
      isGroup: false,
    });

    expect(formatted).toContain('[Quoted Image: "target-456.jpg" saved at "/data/sessions/sess-1/media/target-456.jpg"]');
    expect(formatted).toContain("explain this photo");
  });
});
