import type { proto } from "@whiskeysockets/baileys";

export type MessageKind = "text" | "image" | "audio";

export interface QuotedMessageInfo {
  stanzaId?: string;
  participant?: string;
  phone?: string;
  lid?: string;
  text?: string;
}

export interface ExtractedMessage {
  chatJid: string;
  senderJid: string;
  senderName?: string;
  senderPhone?: string;
  senderLid?: string;
  fromMe: boolean;
  messageId: string;
  kind: MessageKind;
  text: string;
  mentionedJids: string[];
  quoted?: QuotedMessageInfo;
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
  if (m.viewOnceMessageV2Extension?.message) return unwrapMessageContent(m.viewOnceMessageV2Extension.message);
  if (m.ephemeralMessage?.message) return unwrapMessageContent(m.ephemeralMessage.message);
  if (m.documentWithCaptionMessage?.message) return unwrapMessageContent(m.documentWithCaptionMessage.message);
  return m;
}

export function extractMessageText(msg: proto.IWebMessageInfo): string | null {
  const m = unwrapMessageContent(msg.message);
  if (!m) return null;

  const text =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    (m as any).buttonsResponseMessage?.selectedButtonId ??
    (m as any).listResponseMessage?.singleSelectReply?.selectedRowId ??
    (m as any).templateButtonReplyMessage?.selectedId;
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
  const senderName = msg.pushName?.trim() || undefined;

  let senderPhone: string | undefined;
  let senderLid: string | undefined;
  const userPart = senderJid.split("@")[0].split(":")[0];
  if (senderJid.endsWith("@s.whatsapp.net") && /^\d+$/.test(userPart)) {
    senderPhone = `+${userPart}`;
  } else if (senderJid.endsWith("@lid")) {
    senderLid = userPart;
  }

  const contextInfo =
    m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.audioMessage?.contextInfo ??
    (m as any).buttonsResponseMessage?.contextInfo ??
    (m as any).listResponseMessage?.contextInfo;

  let quoted: QuotedMessageInfo | undefined;
  if (contextInfo?.quotedMessage) {
    const quotedText = extractMessageText({ message: contextInfo.quotedMessage } as any) ?? "";
    const quotedParticipant = contextInfo.participant;
    let quotedPhone: string | undefined;
    let quotedLid: string | undefined;
    if (quotedParticipant) {
      const uPart = quotedParticipant.split("@")[0].split(":")[0];
      if (quotedParticipant.endsWith("@s.whatsapp.net") && /^\d+$/.test(uPart)) {
        quotedPhone = `+${uPart}`;
      } else if (quotedParticipant.endsWith("@lid")) {
        quotedLid = uPart;
      }
    }
    quoted = {
      stanzaId: contextInfo.stanzaId ?? undefined,
      participant: quotedParticipant ?? undefined,
      phone: quotedPhone,
      lid: quotedLid,
      text: quotedText,
    };
  }

  // 1. Text message
  const textContent =
    m.conversation ??
    m.extendedTextMessage?.text ??
    (m as any).buttonsResponseMessage?.selectedButtonId ??
    (m as any).listResponseMessage?.singleSelectReply?.selectedRowId ??
    (m as any).templateButtonReplyMessage?.selectedId;
  if (textContent !== undefined && textContent !== null && textContent.trim().length > 0) {
    const mentionedJids = contextInfo?.mentionedJid ?? [];
    return {
      chatJid,
      senderJid,
      senderName,
      senderPhone,
      senderLid,
      fromMe,
      messageId,
      kind: "text",
      text: textContent,
      mentionedJids: mentionedJids.filter(Boolean) as string[],
      quoted,
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
      senderName,
      senderPhone,
      senderLid,
      fromMe,
      messageId,
      kind: "image",
      text: caption,
      mentionedJids: mentionedJids.filter(Boolean) as string[],
      quoted,
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
      senderName,
      senderPhone,
      senderLid,
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

export interface UserPromptAttributionParams {
  text: string;
  senderName?: string;
  senderPhone?: string;
  senderLid?: string;
  isGroup: boolean;
  groupSubject?: string;
  quoted?: QuotedMessageInfo;
  ambientContext?: string;
}

export function formatUserPromptWithAttribution(params: UserPromptAttributionParams): string {
  let identity = params.senderName?.trim() || "";
  if (params.senderPhone) {
    identity = identity ? `${identity} (${params.senderPhone})` : params.senderPhone;
  } else if (params.senderLid) {
    identity = identity ? `${identity} (@${params.senderLid})` : `@${params.senderLid}`;
  }
  if (!identity) {
    identity = "Unknown User";
  }

  const groupPart = params.isGroup
    ? params.groupSubject
      ? ` in "${params.groupSubject}"`
      : " in group"
    : "";

  let prefix = "";
  if (params.ambientContext) {
    prefix += `${params.ambientContext}\n\n`;
  }

  if (params.quoted) {
    const quotedAuthor =
      params.quoted.phone || (params.quoted.lid ? `@${params.quoted.lid}` : params.quoted.participant) || "someone";
    const quotedSnippet = params.quoted.text ? `"${params.quoted.text}"` : "[media / non-text]";
    prefix += `[Replying to ${quotedAuthor}: ${quotedSnippet}]\n`;
  }

  return `${prefix}[From: ${identity}${groupPart}]: ${params.text}`;
}
