import crypto from "crypto";
import type { SessionRegistry } from "./session-registry.js";
import type { MessageKind } from "./message-extractor.js";

export type GatekeeperDecision =
  | { type: "drop" }
  | { type: "reply"; text: string; sessionId?: string }
  | {
      type: "forward";
      sessionId: string;
      text: string;
      kind: MessageKind;
      rawMessage?: any;
      mediaInfo?: any;
    };

export interface SessionGatekeeperOptions {
  secretWord: string;
  registry: SessionRegistry;
  sessionExistsOnDisk: (uuid: string) => boolean | Promise<boolean>;
  onSessionPaused?: (sessionId: string) => void | Promise<void>;
  onSessionResumed?: (sessionId: string, chatJid: string) => void | Promise<void>;
  onSessionStatus?: (sessionId: string, chatJid: string) => Promise<string> | string;
}

export class SessionGatekeeper {
  private readonly secretWord: string;
  private readonly registry: SessionRegistry;
  private readonly sessionExistsOnDisk: (uuid: string) => boolean | Promise<boolean>;
  private readonly onSessionPaused?: (sessionId: string) => void | Promise<void>;
  private readonly onSessionResumed?: (sessionId: string, chatJid: string) => void | Promise<void>;
  private readonly onSessionStatus?: (sessionId: string, chatJid: string) => Promise<string> | string;

  private readonly initRegex = /^\/init-session\s+(\S+)(?:\s+([0-9a-f-]{36}))?$/i;

  constructor(options: SessionGatekeeperOptions) {
    this.secretWord = options.secretWord;
    this.registry = options.registry;
    this.sessionExistsOnDisk = options.sessionExistsOnDisk;
    this.onSessionPaused = options.onSessionPaused;
    this.onSessionResumed = options.onSessionResumed;
    this.onSessionStatus = options.onSessionStatus;
  }

  async handleMessage(msg: {
    chatJid: string;
    senderJid: string;
    text: string;
    kind?: MessageKind;
    rawMessage?: any;
    mediaInfo?: any;
  }): Promise<GatekeeperDecision> {
    const kind: MessageKind = msg.kind ?? "text";
    const trimmed = msg.text.trim();
    const cleanCommand = trimmed.replace(/^@\S+\s*/, "").trim();
    const activeSession = this.registry.findActiveByChatJid(msg.chatJid);

    if (!activeSession) {
      // Chat is UNINITIALIZED
      if (kind === "audio") {
        return { type: "drop" };
      }

      const match = cleanCommand.match(this.initRegex);
      if (!match) {
        return { type: "drop" };
      }

      const [, providedSecret, providedUuid] = match;
      if (providedSecret !== this.secretWord) {
        return { type: "drop" };
      }

      if (!providedUuid) {
        // New session
        const newUuid = crypto.randomUUID();
        this.registry.createSession(newUuid, msg.chatJid);

        return {
          type: "reply",
          text: `session started — save this id to resume it later: ${newUuid}`,
          sessionId: newUuid,
        };
      } else {
        // Resume session by UUID
        const exists = await this.sessionExistsOnDisk(providedUuid);
        if (!exists) {
          // Do not leak whether UUID exists
          return { type: "drop" };
        }

        const existingRecord = this.registry.findById(providedUuid);
        if (existingRecord) {
          this.registry.resumeSession(providedUuid, msg.chatJid);
        } else {
          this.registry.createSession(providedUuid, msg.chatJid);
        }

        if (this.onSessionResumed) {
          await this.onSessionResumed(providedUuid, msg.chatJid);
        }

        return {
          type: "reply",
          text: `session resumed: ${providedUuid}`,
          sessionId: providedUuid,
        };
      }
    }

    // Chat is ACTIVE
    if (kind === "audio") {
      return {
        type: "reply",
        text: "Sorry, I cannot understand audio or voice notes yet. Please send a text message or image.",
        sessionId: activeSession.id,
      };
    }

    if (/^\/deinit-session$/i.test(cleanCommand)) {
      this.registry.pauseSession(activeSession.id);
      if (this.onSessionPaused) {
        await this.onSessionPaused(activeSession.id);
      }
      return {
        type: "reply",
        text: `session paused. Resume anytime with /init-session <secret> ${activeSession.id}`,
        sessionId: activeSession.id,
      };
    }

    if (/^\/init-session(\s+.*)?$/i.test(cleanCommand)) {
      return {
        type: "reply",
        text: `already active. Session ID: ${activeSession.id}`,
        sessionId: activeSession.id,
      };
    }

    if (/^\/session$/i.test(cleanCommand)) {
      if (this.onSessionStatus) {
        const text = await this.onSessionStatus(activeSession.id, msg.chatJid);
        return {
          type: "reply",
          text,
          sessionId: activeSession.id,
        };
      }
      return {
        type: "reply",
        text: `Active Session ID: ${activeSession.id}`,
        sessionId: activeSession.id,
      };
    }

    // Forward message to Pi agent
    this.registry.touchSession(activeSession.id);
    return {
      type: "forward",
      sessionId: activeSession.id,
      text: msg.text,
      kind,
      rawMessage: msg.rawMessage,
      mediaInfo: msg.mediaInfo,
    };
  }
}
