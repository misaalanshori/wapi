import fs from "fs/promises";
import path from "path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { WhatsAppLink } from "./whatsapp-link.js";

import { registerSqliteStorageTool } from "./sqlite-storage.js";
import { registerScheduleTool } from "./schedule-tool.js";
import { registerSendFileTool, type SendFileSender } from "./send-file-tool.js";
import type { SchedulerEngine } from "./scheduler-engine.js";

import { chunkMessage } from "./message-chunker.js";
import { createTimeAwareExtension, stripTimeAwareTags } from "pi-time-aware";

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface SessionPreambleInfo {
  chatJid: string;
  sessionId: string;
  isGroup?: boolean;
  groupSubject?: string;
  groupDescription?: string;
  groupAdmins?: string[];
  participantCount?: number;
}

export function buildDefaultPreamble(
  info: SessionPreambleInfo,
  tz: string,
  customSystemPrompt?: string
): string {
  const lines: string[] = [];
  if (info.isGroup) {
    const subject = info.groupSubject ? ` "${info.groupSubject}"` : "";
    const count = info.participantCount ? `, ${info.participantCount} participants` : "";
    lines.push(
      `You are a personal assistant operating inside WhatsApp group${subject} (JID: ${info.chatJid}${count}).`
    );
    if (info.groupDescription) {
      lines.push(`Group topic / description: "${info.groupDescription.trim()}".`);
    }
    if (info.groupAdmins && info.groupAdmins.length > 0) {
      lines.push(`Group admins: ${info.groupAdmins.join(", ")}.`);
    }
    lines.push(
      `Multiple participants can speak in this chat; each incoming user message is prefixed with the sender's identity.`
    );
    lines.push(
      `When replying, address the relevant participant when helpful, and keep answers concise and suitable for a group conversation.`
    );
    lines.push(
      `To mention or tag a participant in your reply, write their phone number with '@' (e.g. "@6283820039330"); the platform automatically turns this into a clickable WhatsApp notification tag.`
    );
  } else {
    lines.push(
      `You are a personal assistant operating inside WhatsApp in a direct message for chat ${info.chatJid}.`
    );
  }
  lines.push(`Current timezone is ${tz}.`);
  lines.push(
    `A fired schedule's output goes straight to this WhatsApp chat, so make sure your response is something worth sending.`
  );
  lines.push(
    `To send a file, image, document (PDF, CSV, TXT, etc.), or audio back to the user, use the 'send_file' tool with the local file path.`
  );
  if (customSystemPrompt) {
    lines.push(`\n${customSystemPrompt}`);
  }
  return lines.join("\n");
}

export interface AgentSessionManagerOptions {
  dataDir: string;
  sharedAgentDir: string;
  model: any;
  modelRuntime: any;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  tz?: string;
  customSystemPrompt?: string;
  defaultSender?: SendFileSender;
  presenceHeartbeatMs?: number;
  schedulerEngine?: SchedulerEngine;
  extensionFactories?: (sessionDir: string, sessionId: string) => any[];
  sessionFactory?: (options: any) => Promise<{ session: AgentSession; [key: string]: any }>;
  formatPreamble?: (infoOrJid: any, sessionId?: string) => string;
}

export class AgentSessionManager {
  private readonly dataDir: string;
  private readonly sharedAgentDir: string;
  private readonly model: any;
  private readonly modelRuntime: any;
  private readonly thinkingLevel: "off" | "low" | "medium" | "high";
  private readonly tz: string;
  private readonly customSystemPrompt?: string;
  private readonly defaultSender?: SendFileSender;
  private readonly presenceHeartbeatMs: number;
  private readonly schedulerEngine?: SchedulerEngine;
  private readonly extensionFactories?: (sessionDir: string, sessionId: string) => any[];
  private readonly sessionFactory: (options: any) => Promise<{ session: AgentSession; [key: string]: any }>;
  private readonly formatPreamble?: (infoOrJid: any, sessionId?: string) => string;

  private readonly liveSessions = new Map<string, AgentSession>();
  private readonly sessionQueues = new Map<string, Promise<any>>();

  constructor(options: AgentSessionManagerOptions) {
    this.dataDir = options.dataDir;
    this.sharedAgentDir = options.sharedAgentDir;
    this.model = options.model;
    this.modelRuntime = options.modelRuntime;
    this.thinkingLevel = options.thinkingLevel ?? "medium";
    this.tz = options.tz || "Asia/Jakarta";
    this.customSystemPrompt = options.customSystemPrompt;
    this.defaultSender = options.defaultSender;
    this.presenceHeartbeatMs = options.presenceHeartbeatMs ?? 7000;
    this.schedulerEngine = options.schedulerEngine;
    this.extensionFactories = options.extensionFactories;
    this.sessionFactory = options.sessionFactory ?? createAgentSession;
    this.formatPreamble = options.formatPreamble;
  }

  getSessionDir(sessionId: string): string {
    return path.join(this.dataDir, "sessions", sessionId);
  }

  async sessionExistsOnDisk(sessionId: string): Promise<boolean> {
    const dir = this.getSessionDir(sessionId);
    try {
      const stat = await fs.stat(dir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async getOrCreateSession(
    sessionId: string,
    chatJid: string,
    preambleInfo?: Partial<SessionPreambleInfo>,
    sender?: SendFileSender
  ): Promise<AgentSession> {
    const existing = this.liveSessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const sessionDir = this.getSessionDir(sessionId);
    const piSessionDir = path.join(sessionDir, "pi-session");
    const metaPath = path.join(sessionDir, "meta.json");

    await fs.mkdir(sessionDir, { recursive: true });
    await fs.mkdir(piSessionDir, { recursive: true });
    await fs.mkdir(path.join(sessionDir, "storage-backups"), { recursive: true });

    // Write or update meta.json
    try {
      await fs.access(metaPath);
    } catch {
      const meta = {
        sessionId,
        chatJid,
        createdAt: new Date().toISOString(),
        model: {
          id: this.model?.id,
          provider: this.model?.provider,
        },
      };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    }

    const defaultFactories = [
      registerSqliteStorageTool(
        path.join(sessionDir, "storage.sqlite"),
        path.join(sessionDir, "storage-backups")
      ),
      createTimeAwareExtension({ timeZone: this.tz }),
    ];

    if (this.schedulerEngine) {
      defaultFactories.push(registerScheduleTool(sessionId, this.schedulerEngine));
    }

    const effectiveSender = sender || this.defaultSender;
    if (effectiveSender) {
      defaultFactories.push(registerSendFileTool(chatJid, sessionDir, effectiveSender));
    }

    const customFactories = this.extensionFactories ? this.extensionFactories(sessionDir, sessionId) : [];
    const factories = [...defaultFactories, ...customFactories];

    const info: SessionPreambleInfo = {
      chatJid,
      sessionId,
      isGroup: preambleInfo?.isGroup ?? false,
      groupSubject: preambleInfo?.groupSubject,
      groupDescription: preambleInfo?.groupDescription,
      groupAdmins: preambleInfo?.groupAdmins,
      participantCount: preambleInfo?.participantCount,
    };

    let preambleText: string;
    if (this.formatPreamble) {
      preambleText =
        this.formatPreamble.length === 1
          ? this.formatPreamble(info)
          : this.formatPreamble(chatJid, sessionId);
    } else {
      preambleText = buildDefaultPreamble(info, this.tz, this.customSystemPrompt);
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: sessionDir,
      agentDir: this.sharedAgentDir,
      appendSystemPromptOverride: (base) => [...base, preambleText],
      extensionFactories: factories,
    });

    try {
      await resourceLoader.reload();
    } catch {
      // safe fallback if sharedAgentDir is not yet populated
    }

    const sessionManager = SessionManager.create(sessionDir, piSessionDir);

    const result = await this.sessionFactory({
      cwd: sessionDir,
      agentDir: this.sharedAgentDir,
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      modelRuntime: this.modelRuntime,
      resourceLoader,
      tools: [
        "read",
        "write",
        "edit",
        "bash",
        "grep",
        "find",
        "ls",
        "sqlite_storage",
        "schedule",
        "send_file",
      ],
      sessionManager,
    });

    const session = result.session;
    this.liveSessions.set(sessionId, session);
    return session;
  }

  async deliverMessage(
    sessionId: string,
    chatJid: string,
    text: string,
    waLink: WhatsAppLink | { sendPresenceUpdate: (chatJid: string, presence: any) => Promise<any>; sendMessage: (chatJid: string, text: string) => Promise<any> },
    images?: ImageContent[],
    preambleInfo?: Partial<SessionPreambleInfo>
  ): Promise<string | null> {
    const previous = this.sessionQueues.get(sessionId) || Promise.resolve();

    const currentTask = (async () => {
      try {
        await previous;
      } catch {
        // Ignore previous turn failure to avoid blocking subsequent turns
      }
      return this._executeDeliverMessage(sessionId, chatJid, text, waLink, images, preambleInfo);
    })();

    this.sessionQueues.set(sessionId, currentTask);

    try {
      return await currentTask;
    } finally {
      if (this.sessionQueues.get(sessionId) === currentTask) {
        this.sessionQueues.delete(sessionId);
      }
    }
  }

  private async _executeDeliverMessage(
    sessionId: string,
    chatJid: string,
    text: string,
    waLink: WhatsAppLink | { sendPresenceUpdate: (chatJid: string, presence: any) => Promise<any>; sendMessage: (chatJid: string, text: string) => Promise<any>; sendFile?: any },
    images?: ImageContent[],
    preambleInfo?: Partial<SessionPreambleInfo>
  ): Promise<string | null> {
    await waLink.sendPresenceUpdate(chatJid, "composing");
    const heartbeat = setInterval(() => {
      waLink.sendPresenceUpdate(chatJid, "composing").catch(() => {});
    }, this.presenceHeartbeatMs);

    try {
      const session = await this.getOrCreateSession(sessionId, chatJid, preambleInfo, waLink as any);
      const promptOptions: any = { streamingBehavior: "followUp" };
      if (images && images.length > 0) {
        promptOptions.images = images;
      }
      await (session as any).prompt(text, promptOptions);
      const reply = session.getLastAssistantText();
      if (reply && reply.trim().length > 0) {
        const cleanReply = stripTimeAwareTags(reply);
        const chunks = chunkMessage(cleanReply, 4000);
        for (const chunk of chunks) {
          await waLink.sendMessage(chatJid, chunk);
        }
        return reply;
      }
      return null;
    } finally {
      clearInterval(heartbeat);
      await waLink.sendPresenceUpdate(chatJid, "paused");
    }
  }

  async disposeSession(sessionId: string): Promise<void> {
    const session = this.liveSessions.get(sessionId);
    if (session) {
      this.liveSessions.delete(sessionId);
      try {
        session.dispose();
      } catch {
        // ignore errors on dispose
      }
    }
  }

  async disposeAll(): Promise<void> {
    for (const [id, session] of this.liveSessions.entries()) {
      try {
        session.dispose();
      } catch {
        // ignore errors
      }
    }
    this.liveSessions.clear();
  }
}
