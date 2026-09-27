import pino from "pino";
import path from "path";
import { loadConfig } from "./config.js";
import { EchoTracker } from "./echo-tracker.js";
import { WhatsAppLink } from "./whatsapp-link.js";

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
  logger.info({ dataDir: config.dataDir, provider: config.provider, model: config.providerModelId }, "Loaded configuration");

  const echoTracker = new EchoTracker();
  const authDir = path.join(config.dataDir, "baileys-auth");

  const waLink = new WhatsAppLink({
    authDir,
    echoTracker,
    logger,
    onMessage: async (msg) => {
      logger.info({ chat: msg.chatJid, sender: msg.senderJid, text: msg.text }, "Received inbound message");
    },
    qrHttpPort: config.qrHttpPort,
  });

  process.on("SIGINT", async () => {
    logger.info("Stopping on SIGINT...");
    await waLink.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Stopping on SIGTERM...");
    await waLink.stop();
    process.exit(0);
  });

  await waLink.start();
}

import { fileURLToPath } from "url";

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("Fatal startup error:", err.message);
    process.exit(1);
  });
}
