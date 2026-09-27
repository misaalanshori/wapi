import type { proto } from "@whiskeysockets/baileys";

export type MessageKind = "text" | "image" | "audio";

export interface ExtractedMessage {
  chatJid: string;
  senderJid: string;
  fromMe: boolean;
  messageId: string;
  kind: MessageKind;
  text: string;
  mentionedJids: string[];
  rawMessage?: proto.IWebMessageInfo;
  mediaInfo?: {
    mimeType: string;
    seconds?: number;
    isPtt?: boolean;
  };
}

export function unwrapMessageContent(m: proto.IMessage | null | undefined): proto.IMessage | null | undefined {
  if (!m) return m;
  if (m.viewOnceMessage?.message) return unwrapMessageContent(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return unwrapMessageContent(m.viewOnceMessageV2.message);
  if (m.ephemeralMessage?.message) return unwrapMessageContent(m.ephemeralMessage.message);
  return m;
}

export function extractMessageText(msg: proto.IWebMessageInfo): string | null {
  const m = unwrapMessageContent(msg.message);
  if (!m) return null;

  const text = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption;
  if (!text || text.trim().length === 0) {
    return null;
  }
  return text;
}

export function extractMessageInfo(msg: proto.IWebMessageInfo): ExtractedMessage | null {
  const key = msg.key;
  if (!key) return null;

  const chatJid = key.remoteJid;
  if (!chatJid) return null;

  const m = unwrapMessageContent(msg.message);
  if (!m) return null;

  const senderJid = key.participant ?? chatJid;
  const fromMe = Boolean(key.fromMe);
  const messageId = key.id ?? "";

  // 1. Text message
  const textContent = m.conversation ?? m.extendedTextMessage?.text;
  if (textContent !== undefined && textContent !== null && textContent.trim().length > 0) {
    const mentionedJids = m.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    return {
      chatJid,
      senderJid,
      fromMe,
      messageId,
      kind: "text",
      text: textContent,
      mentionedJids: mentionedJids.filter(Boolean) as string[],
      rawMessage: msg,
    };
  }

  // 2. Image message
  if (m.imageMessage) {
    const caption = m.imageMessage.caption ?? "";
    const mentionedJids = m.imageMessage.contextInfo?.mentionedJid ?? [];
    return {
      chatJid,
      senderJid,
      fromMe,
      messageId,
      kind: "image",
      text: caption,
      mentionedJids: mentionedJids.filter(Boolean) as string[],
      rawMessage: msg,
      mediaInfo: {
        mimeType: m.imageMessage.mimetype ?? "image/jpeg",
      },
    };
  }

  // 3. Audio / Voice message
  if (m.audioMessage) {
    const mentionedJids = m.audioMessage.contextInfo?.mentionedJid ?? [];
    return {
      chatJid,
      senderJid,
      fromMe,
      messageId,
      kind: "audio",
      text: "",
      mentionedJids: mentionedJids.filter(Boolean) as string[],
      rawMessage: msg,
      mediaInfo: {
        mimeType: m.audioMessage.mimetype ?? "audio/ogg",
        seconds: m.audioMessage.seconds ?? undefined,
        isPtt: Boolean(m.audioMessage.ptt),
      },
    };
  }

  return null;
}
