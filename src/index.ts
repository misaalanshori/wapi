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
import { AgentSessionManager, type ImageContent } from "./agent-session-manager.js";
import { SchedulerEngine } from "./scheduler-engine.js";
import { MediaManager } from "./media-manager.js";
import { isMessageAddressed } from "./addressing-gate.js";

export async function main() {
  const config = loadConfig();
  process.env.TZ = config.tz;

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

  // Copy bundled skills to agentHomeDir if present
  try {
    const bundledSkillsDir = path.resolve("pi-agent-home/skills");
    const targetSkillsDir = path.join(agentHomeDir, "skills");
    await fs.mkdir(targetSkillsDir, { recursive: true });
    await fs.cp(bundledSkillsDir, targetSkillsDir, { recursive: true });
  } catch (err) {
    logger.debug({ err }, "No bundled skills copied");
  }

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

  let waLink: WhatsAppLink;

  // Initialize Scheduler Engine
  const scheduler = new SchedulerEngine({
    dataDir: config.dataDir,
    registry,
    tz: config.tz,
    minScheduleIntervalSeconds: config.minScheduleIntervalSeconds,
    maxSchedulesPerSession: config.maxSchedulesPerSession,
    onFire: async (item) => {
      logger.info({ sessionId: item.sessionId, scheduleId: item.scheduleId }, "Scheduler fired task");
      try {
        await agentManager.deliverMessage(item.sessionId, item.chatJid, item.prompt, waLink);
      } catch (err) {
        logger.error({ err, sessionId: item.sessionId }, "Failed to deliver scheduled prompt to chat");
      }
    },
  });

  // Initialize Agent Session Manager
  const agentManager = new AgentSessionManager({
    dataDir: config.dataDir,
    sharedAgentDir: agentHomeDir,
    model,
    modelRuntime,
    thinkingLevel: config.thinkingLevel,
    tz: config.tz,
    schedulerEngine: scheduler,
  });

  // Initialize Session Gatekeeper
  const gatekeeper = new SessionGatekeeper({
    secretWord: config.secretWord,
    registry,
    sessionExistsOnDisk: (uuid) => agentManager.sessionExistsOnDisk(uuid),
    onSessionPaused: (id) => agentManager.disposeSession(id),
    onSessionResumed: async (id) => {
      await scheduler.catchUpSession(id);
    },
  });

  const echoTracker = new EchoTracker();
  const authDir = path.join(config.dataDir, "baileys-auth");
  const mediaManager = new MediaManager({ dataDir: config.dataDir });

  // Group participant count cache (5 min TTL)
  const groupParticipantCache = new Map<string, { count: number; expiresAt: number }>();

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
        kind: msg.kind,
        rawMessage: msg.rawMessage,
        mediaInfo: msg.mediaInfo,
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
          let images: ImageContent[] | undefined;
          let promptText = decision.text;

          if (decision.kind === "image" && decision.rawMessage) {
            try {
              const saved = await mediaManager.downloadAndSaveImage(
                decision.sessionId,
                decision.rawMessage,
                sock
              );
              images = [
                {
                  type: "image",
                  data: saved.base64Data,
                  mimeType: saved.mimeType,
                },
              ];
              if (!promptText || promptText.trim().length === 0) {
                promptText = "[User sent an image]";
              }
            } catch (mediaErr) {
              logger.error({ err: mediaErr, sessionId: decision.sessionId }, "Failed to download image message");
              await waLink.sendMessage(msg.chatJid, "Failed to download image. Please try sending it again.");
              return;
            }
          }

          await agentManager.deliverMessage(
            decision.sessionId,
            msg.chatJid,
            promptText,
            waLink,
            images
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
    scheduler.stop();
    await waLink.stop();
    await agentManager.disposeAll();
    registryDb.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await scheduler.start();
  await waLink.start();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("Fatal startup error:", err.message);
    process.exit(1);
  });
}
