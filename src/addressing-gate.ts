import { jidNormalizedUser } from "@whiskeysockets/baileys";

export interface AddressingGateInput {
  chatJid: string;
  isGroup: boolean;
  participantCount: number;
  mentionedJids: string[];
  botJid?: string | null;
  botLid?: string | null;
  botJids?: string[];
  text?: string;
}

export function isMessageAddressed(input: AddressingGateInput): boolean {
  // 1:1 DM is always addressed
  if (!input.isGroup) {
    return true;
  }

  // Group with <= 2 participants is treated like a DM
  if (input.participantCount <= 2) {
    return true;
  }

  // Collect all known bot identifiers
  const targetBotJids: string[] = [];
  if (input.botJids && Array.isArray(input.botJids)) {
    for (const j of input.botJids) {
      if (j) targetBotJids.push(jidNormalizedUser(j));
    }
  }
  if (input.botJid) {
    targetBotJids.push(jidNormalizedUser(input.botJid));
  }
  if (input.botLid) {
    targetBotJids.push(jidNormalizedUser(input.botLid));
  }

  // If no bot identifiers known, cannot match
  if (targetBotJids.length === 0) {
    return false;
  }

  // 1. Check native WhatsApp mentions
  const normalizedMentions = input.mentionedJids.map((jid) => jidNormalizedUser(jid));
  if (normalizedMentions.some((m) => targetBotJids.includes(m))) {
    return true;
  }

  // 2. Check plain text mentions (@bot or @<phone>)
  if (input.text) {
    if (/@bot\b/i.test(input.text)) {
      return true;
    }
    for (const id of targetBotJids) {
      const userPart = id.split("@")[0];
      if (userPart && input.text.includes(`@${userPart}`)) {
        return true;
      }
    }
  }

  return false;
}
