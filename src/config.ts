export interface AppConfig {
  secretWord: string;
  provider: string;
  providerApiKey: string;
  providerModelId: string;
  dataDir: string;
  tz: string;
  logLevel: string;
  thinkingLevel: "off" | "low" | "medium" | "high";
  minScheduleIntervalSeconds: number;
  maxSchedulesPerSession: number;
  qrHttpPort?: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secretWord = env.SECRET_WORD?.trim();
  const provider = env.PROVIDER?.trim();
  const providerApiKey = env.PROVIDER_API_KEY?.trim();
  const providerModelId = env.PROVIDER_MODEL_ID?.trim();

  const missing: string[] = [];
  if (!secretWord) missing.push("SECRET_WORD");
  if (!provider) missing.push("PROVIDER");
  if (!providerApiKey) missing.push("PROVIDER_API_KEY");
  if (!providerModelId) missing.push("PROVIDER_MODEL_ID");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const thinking = env.THINKING_LEVEL?.trim().toLowerCase();
  const validThinking: ("off" | "low" | "medium" | "high")[] = ["off", "low", "medium", "high"];
  const thinkingLevel = validThinking.includes(thinking as any)
    ? (thinking as "off" | "low" | "medium" | "high")
    : "medium";

  const minScheduleIntervalSeconds = env.MIN_SCHEDULE_INTERVAL_SECONDS
    ? parseInt(env.MIN_SCHEDULE_INTERVAL_SECONDS, 10)
    : 60;

  const maxSchedulesPerSession = env.MAX_SCHEDULES_PER_SESSION
    ? parseInt(env.MAX_SCHEDULES_PER_SESSION, 10)
    : 25;

  const qrHttpPort = env.QR_HTTP_PORT ? parseInt(env.QR_HTTP_PORT, 10) : undefined;

  return {
    secretWord: secretWord!,
    provider: provider!,
    providerApiKey: providerApiKey!,
    providerModelId: providerModelId!,
    dataDir: env.DATA_DIR?.trim() || "/data",
    tz: env.TZ?.trim() || "Asia/Jakarta",
    logLevel: env.LOG_LEVEL?.trim() || "info",
    thinkingLevel,
    minScheduleIntervalSeconds,
    maxSchedulesPerSession,
    qrHttpPort,
  };
}
