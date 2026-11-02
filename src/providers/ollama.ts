import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Ollama } from "ollama";

export const OLLAMA_PROVIDER_ID = "ollama";
export const OLLAMA_CLOUD_PROVIDER_ID = "ollama-cloud";

export const DEFAULT_LOCAL_URL = "http://localhost:11434";
export const DEFAULT_CLOUD_URL = "https://ollama.com";

export const DEFAULT_CONTEXT_LENGTH = 131072;
export const DEFAULT_MAX_TOKENS = 16384;

export const DEFAULT_CLOUD_MODELS = [
  "kimi-k2.5",
  "llama3.3",
  "qwen3",
  "mistral",
  "codellama",
  "deepseek-r1",
  "gemma3",
];

export interface OllamaProviderOptions {
  baseUrl?: string;
  cloudUrl?: string;
  apiKey?: string;
  models?: any[];
}

export function getContextLengthFromName(name: string): number {
  const lower = name.toLowerCase();

  // High-context models
  if (lower.includes("deepseek-v4")) return 1048576;
  if (lower.includes("kimi")) return 262144;
  if (lower.includes("qwen3")) return 262144;
  if (lower.includes("minimax")) return 204800;
  if (lower.includes("glm")) return 202752;

  // 128k+ models
  if (lower.includes("llama3.2") || lower.includes("llama3.3") || lower.includes("llama3.1")) return 128000;
  if (lower.includes("deepseek")) return 163840;
  if (lower.includes("gpt-oss")) return 128000;

  // 32k models
  if (lower.includes("qwen2.5") || lower.includes("qwen")) return 32768;
  if (lower.includes("mistral") || lower.includes("mixtral")) return 32768;

  // Smaller context models
  if (lower.includes("llama3")) return 8192;

  return DEFAULT_CONTEXT_LENGTH;
}

export function hasReasoningCapability(modelName: string, capabilities?: string[]): boolean {
  if (capabilities && Array.isArray(capabilities)) {
    const caps = capabilities.map((c) => c.toLowerCase());
    if (caps.includes("thinking") || caps.includes("reason")) {
      return true;
    }
  }

  const lowerName = modelName.toLowerCase();
  if (lowerName.includes("reason")) return true;
  if (/\br1\b/.test(lowerName)) return true;
  if (lowerName.includes("qwq")) return true;
  if (lowerName.includes("deepseek")) return true;
  if (lowerName.includes("gpt-oss")) return true;
  if (lowerName.includes("phi")) return true;

  return false;
}

export function hasVisionCapability(capabilities?: string[], modelInfo?: Record<string, unknown>): boolean {
  if (capabilities && Array.isArray(capabilities)) {
    if (capabilities.some((c) => c.toLowerCase().includes("vision") || c.toLowerCase().includes("image"))) {
      return true;
    }
  }
  if (modelInfo) {
    if (modelInfo["clip.has_vision_encoder"] === true) return true;
    const arch = String(modelInfo["general.architecture"] || "").toLowerCase();
    if (["llava", "bakllava", "moondream", "llava-next"].some((va) => arch.includes(va))) {
      return true;
    }
  }
  return false;
}

export function createOllamaModelConfig(name: string, isCloud: boolean = false, details?: any): any {
  let contextWindow = getContextLengthFromName(name);
  let isVision = false;
  let isReasoning = hasReasoningCapability(name);

  if (details) {
    if (details.capabilities) {
      if (hasVisionCapability(details.capabilities, details.model_info)) isVision = true;
      if (hasReasoningCapability(name, details.capabilities)) isReasoning = true;
    }
    if (details.model_info) {
      for (const [k, v] of Object.entries(details.model_info)) {
        if (k.endsWith(".context_length") && typeof v === "number" && v > 0) {
          contextWindow = v;
          break;
        }
      }
    }
  }

  const cloudEmoji = isCloud ? "☁️ " : "";
  const visionEmoji = isVision ? "👁️ " : "";

  return {
    id: name,
    name: `${cloudEmoji}${visionEmoji}${name}`,
    api: "openai-completions",
    reasoning: isReasoning,
    input: isVision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(contextWindow, DEFAULT_MAX_TOKENS),
  };
}

export function createOllamaProviderConfig(options?: OllamaProviderOptions): any {
  const rawBase = options?.baseUrl || process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || DEFAULT_LOCAL_URL;
  const baseUrl = rawBase.replace(/\/+$/, "").endsWith("/v1")
    ? rawBase.replace(/\/+$/, "")
    : `${rawBase.replace(/\/+$/, "")}/v1`;

  const models = options?.models && options.models.length > 0
    ? options.models
    : [
        createOllamaModelConfig("qwen2.5:latest"),
        createOllamaModelConfig("llama3.2:latest"),
        createOllamaModelConfig("deepseek-r1:latest"),
      ];

  return {
    name: "Ollama",
    baseUrl,
    apiKey: "ollama",
    api: "openai-completions",
    models,
  };
}

export function createOllamaCloudProviderConfig(options?: OllamaProviderOptions): any {
  const rawCloud = options?.cloudUrl || process.env.OLLAMA_HOST_CLOUD || process.env.OLLAMA_CLOUD_URL || DEFAULT_CLOUD_URL;
  const baseUrl = rawCloud.replace(/\/+$/, "").endsWith("/v1")
    ? rawCloud.replace(/\/+$/, "")
    : `${rawCloud.replace(/\/+$/, "")}/v1`;

  const apiKey = options?.apiKey || process.env.OLLAMA_API_KEY || process.env.PROVIDER_API_KEY || "";

  const models = options?.models && options.models.length > 0
    ? options.models
    : DEFAULT_CLOUD_MODELS.map((m) => createOllamaModelConfig(m, true));

  return {
    name: "Ollama Cloud",
    baseUrl,
    apiKey: apiKey ? `$OLLAMA_API_KEY` : "ollama",
    api: "openai-completions",
    models,
  };
}

export async function fetchLocalOllamaModels(baseUrl = DEFAULT_LOCAL_URL): Promise<any[]> {
  try {
    const client = new Ollama({ host: baseUrl });
    const res = await client.list();
    const list = res.models || [];
    const configs: any[] = [];
    for (const m of list) {
      let details: any;
      try {
        details = await client.show({ model: m.name });
      } catch {
        // ignore
      }
      configs.push(createOllamaModelConfig(m.name, false, details));
    }
    return configs.length > 0 ? configs : [];
  } catch {
    return [];
  }
}

export async function fetchCloudOllamaModels(
  cloudUrl = DEFAULT_CLOUD_URL,
  apiKey?: string
): Promise<any[]> {
  if (!apiKey) {
    return DEFAULT_CLOUD_MODELS.map((m) => createOllamaModelConfig(m, true));
  }
  try {
    const client = new Ollama({ host: cloudUrl, headers: { Authorization: `Bearer ${apiKey}` } });
    const res = await client.list();
    const list = res.models || [];
    if (list.length > 0) {
      return list.map((m) => createOllamaModelConfig(m.name, true));
    }
  } catch {
    // fallback
  }
  return DEFAULT_CLOUD_MODELS.map((m) => createOllamaModelConfig(m, true));
}

export async function executeOllamaCli(
  commandArgs: string,
  options?: OllamaProviderOptions
): Promise<string> {
  const localUrl = options?.baseUrl || process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || DEFAULT_LOCAL_URL;
  const cloudUrl = options?.cloudUrl || process.env.OLLAMA_HOST_CLOUD || process.env.OLLAMA_CLOUD_URL || DEFAULT_CLOUD_URL;
  const apiKey = options?.apiKey || process.env.OLLAMA_API_KEY || process.env.PROVIDER_API_KEY || "";

  const trimmed = commandArgs.trim();
  const clean = trimmed.replace(/^\/ollama-?/i, "").trim();
  const [sub, ...rest] = clean ? clean.split(/\s+/) : ["status"];
  const action = (sub || "status").toLowerCase();

  const localClient = new Ollama({ host: localUrl });
  let localRunning = false;
  try {
    await localClient.list();
    localRunning = true;
  } catch {
    localRunning = false;
  }

  if (action === "status") {
    return [
      "🦙 *Ollama Status*",
      "",
      `• Local: ${localRunning ? "✅ Connected" : "❌ Not reachable"} (\`${localUrl}\`)`,
      `• Cloud: ${apiKey ? "✅ API key configured" : "❌ No API key"} (\`${cloudUrl}\`)`,
    ].join("\n");
  }

  if (action === "models") {
    const [localModels, cloudModels] = await Promise.all([
      fetchLocalOllamaModels(localUrl),
      fetchCloudOllamaModels(cloudUrl, apiKey),
    ]);

    const lines = ["🦙 *Ollama Available Models*", ""];
    if (localModels.length > 0) {
      lines.push("*Local:*");
      for (const m of localModels) {
        lines.push(`• \`${m.id}\` (${m.contextWindow.toLocaleString()} tokens ctx)`);
      }
      lines.push("");
    }
    if (cloudModels.length > 0) {
      lines.push("*Cloud:*");
      for (const m of cloudModels) {
        lines.push(`• \`${m.id}\` (${m.contextWindow.toLocaleString()} tokens ctx)`);
      }
    }
    if (localModels.length === 0 && cloudModels.length === 0) {
      lines.push("No models found. Make sure Ollama is running or configure an API key.");
    }
    return lines.join("\n");
  }

  if (action === "info") {
    const modelName = rest.join(" ").trim();
    if (!modelName) {
      return "Usage: `/ollama info <model_name>`";
    }

    let details: any = null;
    let isCloud = false;
    try {
      details = await localClient.show({ model: modelName });
    } catch {
      if (apiKey) {
        try {
          const cloudClient = new Ollama({ host: cloudUrl, headers: { Authorization: `Bearer ${apiKey}` } });
          details = await cloudClient.show({ model: modelName });
          isCloud = true;
        } catch {
          // ignore
        }
      }
    }

    if (!details) {
      return `Could not fetch details for model: \`${modelName}\``;
    }

    const ctx = getContextLengthFromName(modelName);
    const reasoning = hasReasoningCapability(modelName, details.capabilities);
    const vision = hasVisionCapability(details.capabilities, details.model_info);
    const family = details.details?.family || "Unknown";
    const paramSize = details.details?.parameter_size || "Unknown";

    return [
      `🦙 *Model Details: \`${modelName}\`*${isCloud ? " (Cloud)" : ""}`,
      `• Family: ${family}`,
      `• Parameters: ${paramSize}`,
      `• Context Window: ${ctx.toLocaleString()} tokens`,
      `• Vision: ${vision ? "✅ Yes" : "❌ No"}`,
      `• Reasoning: ${reasoning ? "✅ Yes" : "❌ No"}`,
    ].join("\n");
  }

  return [
    "🦙 *Ollama Commands*",
    "• `/ollama status` — Check Ollama connection",
    "• `/ollama models` — List available models",
    "• `/ollama info <model>` — Show model details",
  ].join("\n");
}

export function createOllamaExtension(options?: OllamaProviderOptions) {
  return async (pi: ExtensionAPI): Promise<void> => {
    const localConfig = createOllamaProviderConfig(options);
    const cloudConfig = createOllamaCloudProviderConfig(options);

    pi.registerProvider(OLLAMA_PROVIDER_ID, localConfig);
    pi.registerProvider(OLLAMA_CLOUD_PROVIDER_ID, cloudConfig);

    pi.registerCommand("ollama-status", {
      description: "Check Ollama connection status",
      handler: async (_args: string, ctx: any) => {
        const text = await executeOllamaCli("status", options);
        ctx.ui?.notify?.(text, "info");
      },
    });

    pi.registerCommand("ollama-models", {
      description: "List available Ollama models",
      handler: async (_args: string, ctx: any) => {
        const text = await executeOllamaCli("models", options);
        ctx.ui?.notify?.(text, "info");
      },
    });

    pi.registerCommand("ollama-info", {
      description: "Show Ollama model details",
      handler: async (args: string, ctx: any) => {
        const text = await executeOllamaCli(`info ${args}`, options);
        ctx.ui?.notify?.(text, "info");
      },
    });

    pi.registerCommand("ollama", {
      description: "Ollama management",
      handler: async (args: string, ctx: any) => {
        const text = await executeOllamaCli(args, options);
        ctx.ui?.notify?.(text, "info");
      },
    });
  };
}
