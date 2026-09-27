import { describe, it, expect } from "vitest";
import { extractMessageInfo } from "../src/message-extractor.js";
import type { proto } from "@whiskeysockets/baileys";

describe("extractMessageInfo", () => {
  it("extracts text from simple conversation message", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "123456789@s.whatsapp.net",
        participant: undefined,
        fromMe: false,
        id: "msg-abc",
      },
      message: {
        conversation: "Hello world",
      },
    };

    const info = extractMessageInfo(msg);
    expect(info).not.toBeNull();
    expect(info?.text).toBe("Hello world");
    expect(info?.chatJid).toBe("123456789@s.whatsapp.net");
    expect(info?.senderJid).toBe("123456789@s.whatsapp.net");
    expect(info?.fromMe).toBe(false);
    expect(info?.mentionedJids).toEqual([]);
  });

  it("extracts text and mentions from extendedTextMessage", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "12345-67890@g.us",
        participant: "sender@s.whatsapp.net",
        fromMe: false,
        id: "msg-ext",
      },
      message: {
        extendedTextMessage: {
          text: "@bot do this",
          contextInfo: {
            mentionedJid: ["bot@s.whatsapp.net"],
          },
        },
      },
    };

    const info = extractMessageInfo(msg);
    expect(info).not.toBeNull();
    expect(info?.text).toBe("@bot do this");
    expect(info?.chatJid).toBe("12345-67890@g.us");
    expect(info?.senderJid).toBe("sender@s.whatsapp.net");
    expect(info?.mentionedJids).toEqual(["bot@s.whatsapp.net"]);
  });

  it("returns null for unsupported message types (e.g. sticker, poll)", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "123456789@s.whatsapp.net",
        id: "msg-sticker",
      },
      message: {
        stickerMessage: {
          url: "https://example.com/sticker",
        },
      },
    };

    const info = extractMessageInfo(msg);
    expect(info).toBeNull();
  });

  it("returns null if text is empty or missing", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "123456789@s.whatsapp.net",
        id: "msg-empty",
      },
      message: {
        conversation: "",
      },
    };

    expect(extractMessageInfo(msg)).toBeNull();
  });

  it("extracts text from button responses and list responses", () => {
    const btnMsg: proto.IWebMessageInfo = {
      key: { remoteJid: "user@s.whatsapp.net", id: "btn-1" },
      message: {
        buttonsResponseMessage: {
          selectedButtonId: "CONFIRM_ACTION",
        },
      },
    };
    expect(extractMessageInfo(btnMsg)?.text).toBe("CONFIRM_ACTION");

    const listMsg: proto.IWebMessageInfo = {
      key: { remoteJid: "user@s.whatsapp.net", id: "list-1" },
      message: {
        listResponseMessage: {
          singleSelectReply: {
            selectedRowId: "ITEM_42",
          },
        },
      },
    };
    expect(extractMessageInfo(listMsg)?.text).toBe("ITEM_42");
  });
});
