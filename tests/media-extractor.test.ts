import { describe, it, expect } from "vitest";
import { extractMessageInfo } from "../src/message-extractor.js";
import type { proto } from "@whiskeysockets/baileys";

describe("extractMessageInfo with Media", () => {
  it("extracts image message with caption and mentionedJids", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "chat-media@s.whatsapp.net",
        id: "img-123",
        fromMe: false,
      },
      message: {
        imageMessage: {
          caption: "Look at this chart @bot",
          mimetype: "image/jpeg",
          contextInfo: {
            mentionedJid: ["bot@s.whatsapp.net"],
          },
        },
      },
    };

    const extracted = extractMessageInfo(msg);
    expect(extracted).not.toBeNull();
    expect(extracted?.kind).toBe("image");
    expect(extracted?.text).toBe("Look at this chart @bot");
    expect(extracted?.mediaInfo?.mimeType).toBe("image/jpeg");
    expect(extracted?.mentionedJids).toEqual(["bot@s.whatsapp.net"]);
  });

  it("extracts image message without caption as empty text", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "chat-media@s.whatsapp.net",
        id: "img-456",
        fromMe: false,
      },
      message: {
        imageMessage: {
          mimetype: "image/png",
        },
      },
    };

    const extracted = extractMessageInfo(msg);
    expect(extracted).not.toBeNull();
    expect(extracted?.kind).toBe("image");
    expect(extracted?.text).toBe("");
    expect(extracted?.mediaInfo?.mimeType).toBe("image/png");
  });

  it("extracts viewOnce wrapped imageMessage", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "chat-media@s.whatsapp.net",
        id: "img-vo",
        fromMe: false,
      },
      message: {
        viewOnceMessage: {
          message: {
            imageMessage: {
              caption: "Disappearing image",
              mimetype: "image/jpeg",
            },
          },
        },
      },
    };

    const extracted = extractMessageInfo(msg);
    expect(extracted).not.toBeNull();
    expect(extracted?.kind).toBe("image");
    expect(extracted?.text).toBe("Disappearing image");
  });

  it("extracts audio message and voice note metadata", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "chat-audio@s.whatsapp.net",
        id: "aud-789",
        fromMe: false,
      },
      message: {
        audioMessage: {
          mimetype: "audio/ogg; codecs=opus",
          seconds: 15,
          ptt: true,
          contextInfo: {
            mentionedJid: ["bot@s.whatsapp.net"],
          },
        },
      },
    };

    const extracted = extractMessageInfo(msg);
    expect(extracted).not.toBeNull();
    expect(extracted?.kind).toBe("audio");
    expect(extracted?.mediaInfo?.mimeType).toBe("audio/ogg; codecs=opus");
    expect(extracted?.mediaInfo?.isPtt).toBe(true);
    expect(extracted?.mediaInfo?.seconds).toBe(15);
    expect(extracted?.mentionedJids).toEqual(["bot@s.whatsapp.net"]);
  });
});
