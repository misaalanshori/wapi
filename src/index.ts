import pino from "pino";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { isJidGroup } from "@whiskeysockets/baileys";
import { loadConfig } from "./config.js";
import { EchoTracker } from "./echo-tracker.js";
import { WhatsAppLink } from "./whatsapp-link.js";
import { initModelRuntime } from "./model-runtime.js";
import { SessionRegistry } from "./session-registry.js";
import { SessionGatekeeper } from "./session-gatekeeper.js";
import { AgentSessionManager } from "./agent-session-manager.js";
import { isMessageAddressed } from "./addressing-gate.js";

export async function main() {
  const config = loadConfig();

  const logger = pino({
    level: config.logLevel,
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  });

  logger.info("Starting WhatsApp Personal Assistant...");
  await fs.mkdir(config.dataDir, { recursive: true });

  const agentHomeDir = path.join(config.dataDir, "pi-agent-home");
  logger.info("Initializing Pi model runtime and checking model availability...");
  const { modelRuntime, model } = await initModelRuntime({
    provider: config.provider,
    providerApiKey: config.providerApiKey,
    providerModelId: config.providerModelId,
    agentHomeDir,
  });
  logger.info({ provider: config.provider, modelId: config.providerModelId }, "Model verified successfully");

  // Initialize SQLite Session Registry
  const registryDbPath = path.join(config.dataDir, "registry.sqlite");
  const registryDb = new Database(registryDbPath);
  registryDb.pragma("journal_mode = WAL");
  registryDb.pragma("busy_timeout = 5000");

  const registry = new SessionRegistry(registryDb);

  // Initialize Agent Session Manager
  const agentManager = new AgentSessionManager({
    dataDir: config.dataDir,
    sharedAgentDir: agentHomeDir,
    model,
    modelRuntime,
    thinkingLevel: config.thinkingLevel,
  });

  // Initialize Session Gatekeeper
  const gatekeeper = new SessionGatekeeper({
    secretWord: config.secretWord,
    registry,
    sessionExistsOnDisk: (uuid) => agentManager.sessionExistsOnDisk(uuid),
    onSessionPaused: (id) => agentManager.disposeSession(id),
  });

  const echoTracker = new EchoTracker();
  const authDir = path.join(config.dataDir, "baileys-auth");

  // Group participant count cache (5 min TTL)
  const groupParticipantCache = new Map<string, { count: number; expiresAt: number }>();

  let waLink: WhatsAppLink;

  waLink = new WhatsAppLink({
    authDir,
    echoTracker,
    logger,
    onMessage: async (msg, sock) => {
      const isGroup = Boolean(isJidGroup(msg.chatJid));
      let participantCount = 2;

      if (isGroup) {
        const cached = groupParticipantCache.get(msg.chatJid);
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
          participantCount = cached.count;
        } else {
          try {
            const meta = await sock.groupMetadata(msg.chatJid);
            participantCount = meta.participants?.length ?? 3;
            groupParticipantCache.set(msg.chatJid, { count: participantCount, expiresAt: now + 300_000 });
          } catch (err) {
            logger.debug({ err, chatJid: msg.chatJid }, "Could not fetch group metadata; defaulting count to 3");
            participantCount = 3;
          }
        }
      }

      const addressed = isMessageAddressed({
        chatJid: msg.chatJid,
        isGroup,
        participantCount,
        mentionedJids: msg.mentionedJids,
        botJid: waLink.getBotUserJid(),
      });

      if (!addressed) {
        logger.debug({ chat: msg.chatJid }, "Message not addressed to assistant; dropped");
        return;
      }

      const decision = await gatekeeper.handleMessage({
        chatJid: msg.chatJid,
        senderJid: msg.senderJid,
        text: msg.text,
      });

      if (decision.type === "drop") {
        logger.debug({ chat: msg.chatJid }, "Gatekeeper dropped message");
        return;
      }

      if (decision.type === "reply") {
        await waLink.sendMessage(msg.chatJid, decision.text);
        return;
      }

      if (decision.type === "forward") {
        try {
          await agentManager.deliverMessage(
            decision.sessionId,
            msg.chatJid,
            decision.text,
            waLink
          );
        } catch (err) {
          logger.error({ err, sessionId: decision.sessionId }, "Error delivering message to agent");
        }
      }
    },
    qrHttpPort: config.qrHttpPort,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    await waLink.stop();
    await agentManager.disposeAll();
    registryDb.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await waLink.start();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("Fatal startup error:", err.message);
    process.exit(1);
  });
}
