export interface CompactionConfig {
  softLimitTokens: number;
  idleMinutes: number;
  targetTokens: number;
  headRatio: number;
  tailRatio: number;
}

export interface AppConfig {
  secretWord: string;
  provider: string;
  providerApiKey: string;
  providerModelId: string;
  dataDir: string;
  tz: string;
  logLevel: string;
  thinkingLevel: "off" | "low" | "medium" | "high";
  systemPrompt?: string;
  minScheduleIntervalSeconds: number;
  maxSchedulesPerSession: number;
  qrHttpPort?: number;
  compaction: CompactionConfig;
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
  const systemPrompt = env.SYSTEM_PROMPT?.trim() || env.CUSTOM_SYSTEM_PROMPT?.trim() || undefined;

  const compaction: CompactionConfig = {
    softLimitTokens: env.COMPACTION_SOFT_LIMIT_TOKENS
      ? parseInt(env.COMPACTION_SOFT_LIMIT_TOKENS, 10)
      : 150000,
    idleMinutes: env.COMPACTION_IDLE_MINUTES
      ? parseInt(env.COMPACTION_IDLE_MINUTES, 10)
      : 15,
    targetTokens: env.COMPACTION_TARGET_TOKENS
      ? parseInt(env.COMPACTION_TARGET_TOKENS, 10)
      : 80000,
    headRatio: env.COMPACTION_HEAD_RATIO
      ? parseInt(env.COMPACTION_HEAD_RATIO, 10)
      : 1,
    tailRatio: env.COMPACTION_TAIL_RATIO
      ? parseInt(env.COMPACTION_TAIL_RATIO, 10)
      : 3,
  };

  return {
    secretWord: secretWord!,
    provider: provider!,
    providerApiKey: providerApiKey!,
    providerModelId: providerModelId!,
    dataDir: env.DATA_DIR?.trim() || "/data",
    tz: env.TZ?.trim() || "Asia/Jakarta",
    logLevel: env.LOG_LEVEL?.trim() || "info",
    thinkingLevel,
    systemPrompt,
    minScheduleIntervalSeconds,
    maxSchedulesPerSession,
    qrHttpPort,
    compaction,
  };
}
