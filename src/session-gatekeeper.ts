import crypto from "crypto";
import type { SessionRegistry } from "./session-registry.js";

export type GatekeeperDecision =
  | { type: "drop" }
  | { type: "reply"; text: string; sessionId?: string }
  | { type: "forward"; sessionId: string; text: string };

export interface SessionGatekeeperOptions {
  secretWord: string;
  registry: SessionRegistry;
  sessionExistsOnDisk: (uuid: string) => boolean | Promise<boolean>;
  onSessionPaused?: (sessionId: string) => void | Promise<void>;
  onSessionResumed?: (sessionId: string, chatJid: string) => void | Promise<void>;
}

export class SessionGatekeeper {
  private readonly secretWord: string;
  private readonly registry: SessionRegistry;
  private readonly sessionExistsOnDisk: (uuid: string) => boolean | Promise<boolean>;
  private readonly onSessionPaused?: (sessionId: string) => void | Promise<void>;
  private readonly onSessionResumed?: (sessionId: string, chatJid: string) => void | Promise<void>;

  private readonly initRegex = /^\/init-session\s+(\S+)(?:\s+([0-9a-f-]{36}))?$/i;

  constructor(options: SessionGatekeeperOptions) {
    this.secretWord = options.secretWord;
    this.registry = options.registry;
    this.sessionExistsOnDisk = options.sessionExistsOnDisk;
    this.onSessionPaused = options.onSessionPaused;
    this.onSessionResumed = options.onSessionResumed;
  }

  async handleMessage(msg: {
    chatJid: string;
    senderJid: string;
    text: string;
  }): Promise<GatekeeperDecision> {
    const trimmed = msg.text.trim();
    const activeSession = this.registry.findActiveByChatJid(msg.chatJid);

    if (!activeSession) {
      // Chat is UNINITIALIZED
      const match = trimmed.match(this.initRegex);
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
          // If on disk from prior run but missing in registry
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
    if (/^\/deinit-session$/i.test(trimmed)) {
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

    if (/^\/init-session(\s+.*)?$/i.test(trimmed)) {
      return {
        type: "reply",
        text: `already active. Session ID: ${activeSession.id}`,
        sessionId: activeSession.id,
      };
    }

    // Forward message to Pi agent
    this.registry.touchSession(activeSession.id);
    return {
      type: "forward",
      sessionId: activeSession.id,
      text: msg.text,
    };
  }
}
