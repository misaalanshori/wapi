export interface AmbientChatMessage {
  senderName?: string;
  senderPhone?: string;
  text: string;
  timestamp?: number;
}

export class ChatHistoryBuffer {
  private readonly maxPerChat: number;
  private readonly buffers = new Map<string, AmbientChatMessage[]>();

  constructor(maxPerChat = 15) {
    this.maxPerChat = maxPerChat;
  }

  push(chatJid: string, msg: AmbientChatMessage): void {
    if (!msg.text || msg.text.trim().length === 0) return;

    let list = this.buffers.get(chatJid);
    if (!list) {
      list = [];
      this.buffers.set(chatJid, list);
    }

    list.push({
      ...msg,
      timestamp: msg.timestamp ?? Date.now(),
    });

    if (list.length > this.maxPerChat) {
      list.splice(0, list.length - this.maxPerChat);
    }
  }

  flushFormattedContext(chatJid: string): string | undefined {
    const list = this.buffers.get(chatJid);
    if (!list || list.length === 0) {
      return undefined;
    }

    this.buffers.delete(chatJid);

    const lines: string[] = ["[Recent group context before this message]:"];
    for (const item of list) {
      let author = item.senderName?.trim() || "";
      if (item.senderPhone) {
        author = author ? `${author} (${item.senderPhone})` : item.senderPhone;
      }
      if (!author) {
        author = "Someone";
      }

      let textSnippet = item.text.replace(/\s+/g, " ").trim();
      if (textSnippet.length > 200) {
        textSnippet = textSnippet.slice(0, 197) + "...";
      }

      lines.push(`- ${author}: ${textSnippet}`);
    }

    return lines.join("\n");
  }

  clear(chatJid: string): void {
    this.buffers.delete(chatJid);
  }
}
