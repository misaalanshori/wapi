import type { proto } from "@whiskeysockets/baileys";

export interface ExtractedMessage {
  chatJid: string;
  senderJid: string;
  fromMe: boolean;
  messageId: string;
  text: string;
  mentionedJids: string[];
}

export function extractMessageText(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message;
  if (!m) return null;

  const text = m.conversation ?? m.extendedTextMessage?.text;
  if (!text || text.trim().length === 0) {
    return null;
  }
  return text;
}

export function extractMessageInfo(msg: proto.IWebMessageInfo): ExtractedMessage | null {
  const text = extractMessageText(msg);
  if (!text) return null;

  const key = msg.key;
  if (!key) return null;

  const chatJid = key.remoteJid;
  if (!chatJid) return null;

  const senderJid = key.participant ?? chatJid;
  const fromMe = Boolean(key.fromMe);
  const messageId = key.id ?? "";
  const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];

  return {
    chatJid,
    senderJid,
    fromMe,
    messageId,
    text,
    mentionedJids: mentionedJids.filter(Boolean) as string[],
  };
}
