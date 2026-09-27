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
import { formatUserPromptWithAttribution, unwrapMessageContent } from "./message-extractor.js";
import { ChatHistoryBuffer } from "./chat-history-buffer.js";

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
    customSystemPrompt: config.systemPrompt,
    compactionConfig: config.compaction,
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
    onSessionStatus: async (sessionId, chatJid) => {
      return agentManager.getSessionStatusSummary(sessionId, chatJid);
    },
  });

  const echoTracker = new EchoTracker();
  const authDir = path.join(config.dataDir, "baileys-auth");
  const mediaManager = new MediaManager({ dataDir: config.dataDir });
  const chatHistoryBuffer = new ChatHistoryBuffer(15);

  // Group metadata cache (5 min TTL)
  const groupMetadataCache = new Map<
    string,
    {
      count: number;
      subject?: string;
      description?: string;
      admins?: string[];
      expiresAt: number;
    }
  >();

  waLink = new WhatsAppLink({
    authDir,
    echoTracker,
    logger,
    onGroupUpdate: (chatJid) => {
      groupMetadataCache.delete(chatJid);
      logger.debug({ chatJid }, "Invalidated group metadata cache on group update");
    },
    onMessage: async (msg, sock) => {
      const isGroup = Boolean(isJidGroup(msg.chatJid));
      let participantCount = 2;
      let groupSubject: string | undefined;
      let groupDescription: string | undefined;
      let groupAdmins: string[] | undefined;

      if (isGroup) {
        const cached = groupMetadataCache.get(msg.chatJid);
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
          participantCount = cached.count;
          groupSubject = cached.subject;
          groupDescription = cached.description;
          groupAdmins = cached.admins;
        } else {
          try {
            const meta = await sock.groupMetadata(msg.chatJid);
            participantCount = meta.participants?.length ?? 3;
            groupSubject = meta.subject;
            groupDescription = meta.desc ? meta.desc.toString() : undefined;
            groupAdmins = meta.participants
              ?.filter((p: any) => p.admin)
              ?.map((p: any) => p.id.split("@")[0].split(":")[0])
              ?.map((pn: string) => `+${pn}`);
            if (Array.isArray(meta.participants)) {
              waLink.registerParticipants(msg.chatJid, meta.participants.map((p: any) => p.id));
            }
            groupMetadataCache.set(msg.chatJid, {
              count: participantCount,
              subject: groupSubject,
              description: groupDescription,
              admins: groupAdmins,
              expiresAt: now + 300_000,
            });
          } catch (err) {
            logger.debug({ err, chatJid: msg.chatJid }, "Could not fetch group metadata; defaulting count to 3");
            participantCount = 3;
          }
        }
      }

      const isInitAttempt = /^(?:@\S+\s+)?\/init-session\b/i.test(msg.text.trim());
      const addressed =
        isInitAttempt ||
        isMessageAddressed({
          chatJid: msg.chatJid,
          isGroup,
          participantCount,
          mentionedJids: msg.mentionedJids,
          quotedParticipant: msg.quoted?.participant,
          botJid: waLink.getBotUserJid(),
          botLid: waLink.getBotLid(),
          botJids: waLink.getBotJids(),
          text: msg.text,
        });

      if (!addressed) {
        if (isGroup && registry.findActiveByChatJid(msg.chatJid) && msg.text) {
          let replyTo: { author?: string; text?: string } | undefined;
          if (msg.quoted) {
            replyTo = {
              author: msg.quoted.phone || (msg.quoted.lid ? `@${msg.quoted.lid}` : msg.quoted.participant),
              text: msg.quoted.text,
            };
          }
          chatHistoryBuffer.push(msg.chatJid, {
            senderName: msg.senderName,
            senderPhone: msg.senderPhone,
            senderLid: msg.senderLid,
            text: msg.text,
            replyTo,
          });
        }
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

          // If current message has no image, but quotes an image or sticker, download quoted media
          const quotedUnwrapped = unwrapMessageContent(msg.quoted?.rawMessage?.message);
          const hasQuotedMedia = Boolean(
            quotedUnwrapped?.imageMessage || quotedUnwrapped?.stickerMessage
          );
          if (!images && hasQuotedMedia && msg.quoted?.rawMessage) {
            try {
              const saved = await mediaManager.downloadAndSaveImage(
                decision.sessionId,
                msg.quoted.rawMessage,
                sock
              );
              images = [
                {
                  type: "image",
                  data: saved.base64Data,
                  mimeType: saved.mimeType,
                },
              ];
            } catch (mediaErr) {
              logger.debug(
                { err: mediaErr, sessionId: decision.sessionId },
                "Could not download quoted media; proceeding with text prompt"
              );
            }
          }

          if (decision.kind === "document" && decision.rawMessage) {
            try {
              const saved = await mediaManager.downloadAndSaveDocument(
                decision.sessionId,
                decision.rawMessage,
                sock
              );
              const sizeKb = Math.round(saved.sizeBytes / 1024);
              const docNotice = `[Attached Document: "${saved.fileName}" saved at "${saved.filePath}" (${sizeKb} KB, mime: ${saved.mimeType})]`;
              promptText = promptText ? `${docNotice}\n${promptText}` : docNotice;
            } catch (mediaErr) {
              logger.error({ err: mediaErr, sessionId: decision.sessionId }, "Failed to download document message");
              await waLink.sendMessage(msg.chatJid, "Failed to download document. Please try sending it again.");
              return;
            }
          }

          // If current message quotes a document, download the quoted document for the agent
          if (quotedUnwrapped?.documentMessage && msg.quoted?.rawMessage) {
            try {
              const saved = await mediaManager.downloadAndSaveDocument(
                decision.sessionId,
                msg.quoted.rawMessage,
                sock
              );
              const sizeKb = Math.round(saved.sizeBytes / 1024);
              const quotedDocNotice = `[Quoted Document: "${saved.fileName}" saved at "${saved.filePath}" (${sizeKb} KB, mime: ${saved.mimeType})]`;
              promptText = `${quotedDocNotice}\n${promptText}`;
            } catch (mediaErr) {
              logger.debug({ err: mediaErr, sessionId: decision.sessionId }, "Could not download quoted document");
            }
          }

          const ambientContext = isGroup ? chatHistoryBuffer.flushFormattedContext(msg.chatJid) : undefined;

          const attributedPrompt = formatUserPromptWithAttribution({
            text: promptText,
            senderName: msg.senderName,
            senderPhone: msg.senderPhone,
            isGroup,
            groupSubject,
            quoted: msg.quoted,
            ambientContext,
          });

          await agentManager.deliverMessage(
            decision.sessionId,
            msg.chatJid,
            attributedPrompt,
            waLink,
            images,
            { isGroup, groupSubject, groupDescription, groupAdmins, participantCount }
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
