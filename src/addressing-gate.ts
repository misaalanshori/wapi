import { jidNormalizedUser } from "@whiskeysockets/baileys";

export interface AddressingGateInput {
  chatJid: string;
  isGroup: boolean;
  participantCount: number;
  mentionedJids: string[];
  botJid: string | null;
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

  // If we don't know the bot's own JID, we can't match mentions
  if (!input.botJid) {
    return false;
  }

  const normalizedBotJid = jidNormalizedUser(input.botJid);
  const normalizedMentions = input.mentionedJids.map((jid) => jidNormalizedUser(jid));

  return normalizedMentions.includes(normalizedBotJid);
}
