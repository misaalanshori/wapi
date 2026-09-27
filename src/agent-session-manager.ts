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
import type { SchedulerEngine } from "./scheduler-engine.js";

import { chunkMessage } from "./message-chunker.js";
import { createTimeAwareExtension, stripTimeAwareTags } from "pi-time-aware";

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface AgentSessionManagerOptions {
  dataDir: string;
  sharedAgentDir: string;
  model: any;
  modelRuntime: any;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  tz?: string;
  schedulerEngine?: SchedulerEngine;
  extensionFactories?: (sessionDir: string, sessionId: string) => any[];
  sessionFactory?: (options: any) => Promise<{ session: AgentSession; [key: string]: any }>;
  formatPreamble?: (chatJid: string, sessionId: string) => string;
}

export class AgentSessionManager {
  private readonly dataDir: string;
  private readonly sharedAgentDir: string;
  private readonly model: any;
  private readonly modelRuntime: any;
  private readonly thinkingLevel: "off" | "low" | "medium" | "high";
  private readonly tz: string;
  private readonly schedulerEngine?: SchedulerEngine;
  private readonly extensionFactories?: (sessionDir: string, sessionId: string) => any[];
  private readonly sessionFactory: (options: any) => Promise<{ session: AgentSession; [key: string]: any }>;
  private readonly formatPreamble?: (chatJid: string, sessionId: string) => string;

  private readonly liveSessions = new Map<string, AgentSession>();

  constructor(options: AgentSessionManagerOptions) {
    this.dataDir = options.dataDir;
    this.sharedAgentDir = options.sharedAgentDir;
    this.model = options.model;
    this.modelRuntime = options.modelRuntime;
    this.thinkingLevel = options.thinkingLevel ?? "medium";
    this.tz = options.tz || "Asia/Jakarta";
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

  async getOrCreateSession(sessionId: string, chatJid: string): Promise<AgentSession> {
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

    const customFactories = this.extensionFactories ? this.extensionFactories(sessionDir, sessionId) : [];
    const factories = [...defaultFactories, ...customFactories];
    const preambleText = this.formatPreamble
      ? this.formatPreamble(chatJid, sessionId)
      : `You are a personal assistant operating inside WhatsApp for chat ${chatJid}.`;

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
      tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
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
    images?: ImageContent[]
  ): Promise<string | null> {
    const session = await this.getOrCreateSession(sessionId, chatJid);

    await waLink.sendPresenceUpdate(chatJid, "composing");
    try {
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
