import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  jidNormalizedUser,
  DisconnectReason,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import qrcode from "qrcode-terminal";
import fs from "fs/promises";
import { EchoTracker } from "./echo-tracker.js";
import { extractMessageInfo, type ExtractedMessage } from "./message-extractor.js";
import { getDisconnectAction, DisconnectAction } from "./reconnect-policy.js";

export interface WhatsAppLinkOptions {
  authDir: string;
  echoTracker: EchoTracker;
  logger: Logger;
  onMessage: (msg: ExtractedMessage, sock: WASocket) => Promise<void> | void;
  onReady?: () => void;
  onGroupUpdate?: (chatJid: string) => void;
  qrHttpPort?: number;
}

export class WhatsAppLink {
  private readonly authDir: string;
  private readonly echoTracker: EchoTracker;
  private readonly logger: Logger;
  private readonly onMessage: (msg: ExtractedMessage, sock: WASocket) => Promise<void> | void;
  private readonly onReady?: () => void;
  private readonly onGroupUpdate?: (chatJid: string) => void;

  private socket: WASocket | null = null;
  private retryCount = 0;
  private isStopping = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(options: WhatsAppLinkOptions) {
    this.authDir = options.authDir;
    this.echoTracker = options.echoTracker;
    this.logger = options.logger;
    this.onMessage = options.onMessage;
    this.onReady = options.onReady;
    this.onGroupUpdate = options.onGroupUpdate;
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  getBotUserJid(): string | null {
    if (!this.socket?.user?.id) return null;
    return jidNormalizedUser(this.socket.user.id);
  }

  async start(): Promise<void> {
    this.isStopping = false;
    await fs.mkdir(this.authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: undefined,
    }));

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          this.logger.child({ module: "baileys-keys" }) as any
        ),
      },
      logger: this.logger.child({ module: "baileys" }) as any,
      printQRInTerminal: false,
    });

    this.socket = sock;
    this.attachSocketEvents(sock, saveCreds);
  }

  attachSocketEvents(sock: WASocket, saveCreds?: () => Promise<void>): void {
    this.socket = sock;

    sock.ev.on("creds.update", async () => {
      if (saveCreds) {
        try {
          await saveCreds();
        } catch (err) {
          this.logger.error({ err }, "Failed to save Baileys credentials");
        }
      }
    });

    sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.logger.info("Scan the QR code below to link WhatsApp account:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        this.retryCount = 0;
        this.logger.info(
          { user: sock.user?.id },
          "WhatsApp connection opened successfully"
        );
        this.onReady?.();
      } else if (connection === "close") {
        if (this.isStopping) return;

        const decision = getDisconnectAction(lastDisconnect?.error, this.retryCount);
        this.logger.warn(
          { error: lastDisconnect?.error, decision, retryCount: this.retryCount },
          "WhatsApp connection closed"
        );

        if (decision.action === DisconnectAction.WipeAndRepair) {
          this.logger.error(
            "Logged out or session corrupted. Wiping auth credentials to re-pair."
          );
          try {
            await fs.rm(this.authDir, { recursive: true, force: true });
          } catch (err) {
            this.logger.error({ err }, "Error removing auth directory");
          }
          this.retryCount = 0;
          await this.scheduleReconnect(0);
        } else {
          this.retryCount++;
          await this.scheduleReconnect(decision.backoffMs);
        }
      }
    });

    sock.ev.on("messages.upsert", async (upsert: { type: string; messages: any[] }) => {
      if (upsert.type !== "notify") return;

      for (const rawMsg of upsert.messages) {
        try {
          const msgId = rawMsg?.key?.id;
          if (msgId && this.echoTracker.isSelfEcho(msgId)) {
            this.logger.debug({ msgId }, "Dropped self-echo outbound message");
            continue;
          }

          const info = extractMessageInfo(rawMsg);
          if (!info) {
            continue;
          }

          await this.onMessage(info, sock);
        } catch (err) {
          this.logger.error({ err, rawMsg }, "Error processing inbound message");
        }
      }
    });

    sock.ev.on("group-participants.update", (update: { id: string }) => {
      if (update?.id && this.onGroupUpdate) {
        this.onGroupUpdate(update.id);
      }
    });

    sock.ev.on("groups.update", (updates: any[]) => {
      if (Array.isArray(updates) && this.onGroupUpdate) {
        for (const u of updates) {
          if (u?.id) {
            this.onGroupUpdate(u.id);
          }
        }
      }
    });
  }

  private async scheduleReconnect(backoffMs: number): Promise<void> {
    if (this.isStopping) return;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (backoffMs <= 0) {
      await this.start().catch((err) => {
        this.logger.error({ err }, "Error during immediate reconnect");
      });
      return;
    }

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      await this.start().catch((err) => {
        this.logger.error({ err }, "Error during scheduled reconnect");
      });
    }, backoffMs);
  }

  async sendMessage(chatJid: string, text: string): Promise<string> {
    if (!this.socket) {
      throw new Error("Cannot send message: WhatsApp socket is not connected");
    }

    const messageId = generateMessageIDV2(this.socket.user?.id);
    this.echoTracker.track(messageId);

    await this.socket.sendMessage(
      chatJid,
      { text },
      { messageId }
    );

    return messageId;
  }

  async sendPresenceUpdate(chatJid: string, presence: "composing" | "paused"): Promise<void> {
    if (!this.socket) return;
    try {
      await this.socket.sendPresenceUpdate(presence, chatJid);
    } catch (err) {
      this.logger.debug({ err, chatJid, presence }, "Failed to send presence update");
    }
  }

  async stop(): Promise<void> {
    this.isStopping = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      try {
        (this.socket.ev as any).removeAllListeners?.();
        this.socket.end(undefined);
      } catch {
        // ignore on stop
      }
      this.socket = null;
    }
  }
}
