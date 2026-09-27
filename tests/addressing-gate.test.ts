import { describe, it, expect } from "vitest";
import { isMessageAddressed } from "../src/addressing-gate.js";

describe("isMessageAddressed", () => {
  const botJid = "1234567890@s.whatsapp.net";

  it("is always addressed in a 1:1 DM", () => {
    const result = isMessageAddressed({
      chatJid: "987654321@s.whatsapp.net",
      isGroup: false,
      participantCount: 2,
      mentionedJids: [],
      botJid,
    });
    expect(result).toBe(true);
  });

  it("is always addressed in a group with 2 or fewer participants", () => {
    const result = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 2,
      mentionedJids: [],
      botJid,
    });
    expect(result).toBe(true);
  });

  it("is NOT addressed in a group with >2 participants when bot is not mentioned", () => {
    const result = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 5,
      mentionedJids: ["other-user@s.whatsapp.net"],
      botJid,
    });
    expect(result).toBe(false);
  });

  it("is addressed in a group with >2 participants when bot is mentioned", () => {
    const result = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 5,
      mentionedJids: ["1234567890@s.whatsapp.net"],
      botJid,
    });
    expect(result).toBe(true);
  });

  it("correctly matches bot JID even with device suffix (:1, :2) in mentionedJids or botJid", () => {
    const result = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 4,
      mentionedJids: ["1234567890:42@s.whatsapp.net"],
      botJid: "1234567890:1@s.whatsapp.net",
    });
    expect(result).toBe(true);
  });

  it("matches bot LID in mentionedJids", () => {
    const result = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 4,
      mentionedJids: ["59652867924008:9@lid"],
      botJid: "1234567890:1@s.whatsapp.net",
      botLid: "59652867924008@lid",
    });
    expect(result).toBe(true);
  });

  it("matches literal @bot or @<phone> in message text", () => {
    const result = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 4,
      mentionedJids: [],
      botJid: "1234567890@s.whatsapp.net",
      text: "@bot introduce yourself",
    });
    expect(result).toBe(true);

    const resultPhone = isMessageAddressed({
      chatJid: "12345-67890@g.us",
      isGroup: true,
      participantCount: 4,
      mentionedJids: [],
      botJid: "1234567890@s.whatsapp.net",
      text: "@1234567890 hello",
    });
    expect(resultPhone).toBe(true);
  });
});
