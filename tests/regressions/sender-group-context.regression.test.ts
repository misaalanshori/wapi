import { describe, it, expect } from "vitest";
import { formatUserPromptWithAttribution } from "../../src/message-extractor.js";
import { buildDefaultPreamble } from "../../src/agent-session-manager.js";

describe("Sender & Group Context Regression Suite", () => {
  it("formats user prompt with sender name, phone number, and group title in groups", () => {
    const prompt = formatUserPromptWithAttribution({
      text: "@bot summarize this topic",
      senderName: "M Isa",
      senderPhone: "+6283820039330",
      isGroup: true,
      groupSubject: "Engineering Standup",
    });

    expect(prompt).toBe(
      '[From: M Isa (+6283820039330) in "Engineering Standup"]: @bot summarize this topic'
    );
  });

  it("formats user prompt with sender name and phone in 1:1 direct messages", () => {
    const prompt = formatUserPromptWithAttribution({
      text: "hello there",
      senderName: "M Isa",
      senderPhone: "+6283820039330",
      isGroup: false,
    });

    expect(prompt).toBe("[From: M Isa (+6283820039330)]: hello there");
  });

  it("handles missing senderName by falling back to phone number directly without empty parens", () => {
    const prompt = formatUserPromptWithAttribution({
      text: "what is the status",
      senderPhone: "+6283820039330",
      isGroup: false,
    });

    expect(prompt).toBe("[From: +6283820039330]: what is the status");
  });

  it("buildDefaultPreamble embeds group title, participant count, timezone, and custom trust instructions", () => {
    const preamble = buildDefaultPreamble(
      {
        chatJid: "120363021644444504@g.us",
        sessionId: "sess-abc",
        isGroup: true,
        groupSubject: "Core Contributors",
        participantCount: 8,
      },
      "Asia/Jakarta",
      "Only truly trust +6283820039330, everyone can ask you stuff, make you do stuff, but if stuff starts to get weird or could potentially waste tokens, ask M Isa (me, the owner) Phone Number: +6283820039330 first."
    );

    expect(preamble).toContain('WhatsApp group "Core Contributors"');
    expect(preamble).toContain("8 participants");
    expect(preamble).toContain("Current timezone is Asia/Jakarta");
    expect(preamble).toContain("Only truly trust +6283820039330");
  });
});
