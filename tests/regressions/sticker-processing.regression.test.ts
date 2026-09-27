import { describe, it, expect } from "vitest";
import {
  extractMessageInfo,
  formatUserPromptWithAttribution,
} from "../../src/message-extractor.js";
import type { proto } from "@whiskeysockets/baileys";

describe("Sticker Processing Regression Suite", () => {
  it("extracts inbound sticker message as image kind with webp mimetype", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "group-1@g.us",
        participant: "user-1@s.whatsapp.net",
        id: "stk-reg-1",
        fromMe: false,
      },
      message: {
        stickerMessage: {
          mimetype: "image/webp",
          isAnimated: false,
        },
      },
    };

    const info = extractMessageInfo(msg);
    expect(info).not.toBeNull();
    expect(info?.kind).toBe("image");
    expect(info?.text).toBe("[User sent a sticker]");
    expect(info?.mediaInfo?.mimeType).toBe("image/webp");
  });

  it("extracts animated sticker with animated indicator", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "user@s.whatsapp.net",
        id: "stk-reg-2",
        fromMe: false,
      },
      message: {
        stickerMessage: {
          mimetype: "image/webp",
          isAnimated: true,
        },
      },
    };

    const info = extractMessageInfo(msg);
    expect(info?.text).toBe("[User sent an animated sticker]");
  });

  it("formats prompt when quoting a sticker with [Sticker] snippet instead of [media / non-text]", () => {
    const formatted = formatUserPromptWithAttribution({
      text: "what is this meme?",
      senderName: "M Isa",
      senderPhone: "+6283820039330",
      isGroup: true,
      groupSubject: "PT WOKEUPLAIKDIS",
      quoted: {
        phone: "+628111111",
        text: "[Sticker]",
      },
    });

    expect(formatted).toBe(
      '[Replying to +628111111: "[Sticker]"]\n[From: M Isa (+6283820039330) in "PT WOKEUPLAIKDIS"]: what is this meme?'
    );
  });
});
