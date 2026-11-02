import path from "path";
import fs from "fs/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  OPENDESIGN_PROVIDER_ID,
  createOpenDesignProviderConfig,
  formatModelDisplayName,
} from "./providers/opendesign.js";
import {
  OLLAMA_PROVIDER_ID,
  OLLAMA_CLOUD_PROVIDER_ID,
  DEFAULT_CLOUD_MODELS,
  createOllamaModelConfig,
  createOllamaProviderConfig,
  createOllamaCloudProviderConfig,
} from "./providers/ollama.js";

export interface ModelRuntimeInitOptions {
  provider: string;
  providerApiKey: string;
  providerModelId: string;
  fallbackProvider?: string;
  fallbackModelId?: string;
  fallbackApiKey?: string;
  agentHomeDir: string;
  runtimeFactory?: (options: { authPath: string; modelsPath: string }) => Promise<ModelRuntime>;
}

export interface ModelRuntimeInitResult {
  modelRuntime: ModelRuntime;
  model: any;
  fallbackModel?: any;
}

export function registerSupportedProviders(
  modelRuntime: any,
  options?: {
    opendesignApiKey?: string;
    ollamaApiKey?: string;
    provider?: string;
    providerModelId?: string;
    fallbackProvider?: string;
    fallbackModelId?: string;
  }
): void {
  if (typeof modelRuntime?.registerProvider !== "function") return;

  // 1. OpenDesign Provider
  const odConfig = createOpenDesignProviderConfig();
  if (options?.provider === "opendesign" && options.providerModelId) {
    if (!odConfig.models.some((m: any) => m.id === options.providerModelId)) {
      odConfig.models.push({
        id: options.providerModelId,
        name: formatModelDisplayName(options.providerModelId),
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: true,
        contextWindow: 1048000,
        maxTokens: 32000,
      });
    }
  }
  if (options?.fallbackProvider === "opendesign" && options.fallbackModelId) {
    if (!odConfig.models.some((m: any) => m.id === options.fallbackModelId)) {
      odConfig.models.push({
        id: options.fallbackModelId,
        name: formatModelDisplayName(options.fallbackModelId),
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: true,
        contextWindow: 1048000,
        maxTokens: 32000,
      });
    }
  }
  try {
    modelRuntime.registerProvider(OPENDESIGN_PROVIDER_ID, odConfig);
  } catch {
    // non-fatal
  }

  // 2. Ollama & Ollama Cloud Providers
  const localModels = [
    createOllamaModelConfig("qwen2.5:latest"),
    createOllamaModelConfig("llama3.2:latest"),
    createOllamaModelConfig("deepseek-r1:latest"),
  ];
  if (options?.provider === "ollama" && options.providerModelId) {
    if (!localModels.some((m: any) => m.id === options.providerModelId)) {
      localModels.push(createOllamaModelConfig(options.providerModelId, false));
    }
  }
  if (options?.fallbackProvider === "ollama" && options.fallbackModelId) {
    if (!localModels.some((m: any) => m.id === options.fallbackModelId)) {
      localModels.push(createOllamaModelConfig(options.fallbackModelId, false));
    }
  }

  const cloudModels = DEFAULT_CLOUD_MODELS.map((m) => createOllamaModelConfig(m, true));
  if (options?.provider === "ollama-cloud" && options.providerModelId) {
    if (!cloudModels.some((m: any) => m.id === options.providerModelId)) {
      cloudModels.push(createOllamaModelConfig(options.providerModelId, true));
    }
  }
  if (options?.fallbackProvider === "ollama-cloud" && options.fallbackModelId) {
    if (!cloudModels.some((m: any) => m.id === options.fallbackModelId)) {
      cloudModels.push(createOllamaModelConfig(options.fallbackModelId, true));
    }
  }

  try {
    modelRuntime.registerProvider(
      OLLAMA_PROVIDER_ID,
      createOllamaProviderConfig({ models: localModels })
    );
    modelRuntime.registerProvider(
      OLLAMA_CLOUD_PROVIDER_ID,
      createOllamaCloudProviderConfig({ models: cloudModels, apiKey: options?.ollamaApiKey })
    );
  } catch {
    // non-fatal
  }
}

export async function ensureCustomModelInModelsJson(
  modelsPath: string,
  provider: string,
  modelId: string
): Promise<void> {
  let config: any = {};
  try {
    const raw = await fs.readFile(modelsPath, "utf8");
    config = JSON.parse(raw);
  } catch {
    config = {};
  }

  config.providers = config.providers || {};
  config.providers[provider] = config.providers[provider] || {};
  const models = config.providers[provider].models || [];

  if (!models.some((m: any) => m.id === modelId)) {
    models.push({
      id: modelId,
      name: modelId,
      api: "openai-completions",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 131072,
    });
    config.providers[provider].models = models;
    await fs.writeFile(modelsPath, JSON.stringify(config, null, 2), "utf8");
  }
}

export async function initModelRuntime(
  options: ModelRuntimeInitOptions
): Promise<ModelRuntimeInitResult> {
  const { provider, providerApiKey, providerModelId, agentHomeDir } = options;

  await fs.mkdir(agentHomeDir, { recursive: true });
  const authPath = path.join(agentHomeDir, "auth.json");
  const modelsPath = path.join(agentHomeDir, "models.json");

  const factory = options.runtimeFactory ?? ((opts) => ModelRuntime.create(opts));
  let modelRuntime = await factory({ authPath, modelsPath });

  registerSupportedProviders(modelRuntime, {
    provider,
    providerModelId,
    fallbackProvider: options.fallbackProvider,
    fallbackModelId: options.fallbackModelId,
    opendesignApiKey: provider === "opendesign" ? providerApiKey : options.fallbackApiKey,
    ollamaApiKey: provider === "ollama-cloud" ? providerApiKey : options.fallbackApiKey,
  });

  await modelRuntime.setRuntimeApiKey(provider, providerApiKey);

  let model = modelRuntime.getModel(provider, providerModelId);
  if (!model && !options.runtimeFactory) {
    await ensureCustomModelInModelsJson(modelsPath, provider, providerModelId);
    modelRuntime = await factory({ authPath, modelsPath });
    registerSupportedProviders(modelRuntime, {
      provider,
      providerModelId,
      fallbackProvider: options.fallbackProvider,
      fallbackModelId: options.fallbackModelId,
      opendesignApiKey: provider === "opendesign" ? providerApiKey : options.fallbackApiKey,
      ollamaApiKey: provider === "ollama-cloud" ? providerApiKey : options.fallbackApiKey,
    });
    model = modelRuntime.getModel(provider, providerModelId);
  }

  if (!model) {
    throw new Error(
      `Configured model "${provider}/${providerModelId}" was not found. ` +
        `Check PROVIDER / PROVIDER_MODEL_ID before the QR will be shown.`
    );
  }

  let fallbackModel: any;
  if (options.fallbackModelId) {
    const fProv = options.fallbackProvider || provider;
    const fKey = options.fallbackApiKey || providerApiKey;
    await modelRuntime.setRuntimeApiKey(fProv, fKey);

    fallbackModel = modelRuntime.getModel(fProv, options.fallbackModelId);
    if (!fallbackModel && !options.runtimeFactory) {
      await ensureCustomModelInModelsJson(modelsPath, fProv, options.fallbackModelId);
      modelRuntime = await factory({ authPath, modelsPath });
      registerSupportedProviders(modelRuntime, {
        provider,
        providerModelId,
        fallbackProvider: options.fallbackProvider,
        fallbackModelId: options.fallbackModelId,
        opendesignApiKey: provider === "opendesign" ? providerApiKey : options.fallbackApiKey,
        ollamaApiKey: provider === "ollama-cloud" ? providerApiKey : options.fallbackApiKey,
      });
      fallbackModel = modelRuntime.getModel(fProv, options.fallbackModelId);
    }
  }

  return { modelRuntime, model, fallbackModel };
}
