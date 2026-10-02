import path from "path";
import fs from "fs/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

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

  await modelRuntime.setRuntimeApiKey(provider, providerApiKey);

  let model = modelRuntime.getModel(provider, providerModelId);
  if (!model && !options.runtimeFactory) {
    await ensureCustomModelInModelsJson(modelsPath, provider, providerModelId);
    modelRuntime = await factory({ authPath, modelsPath });
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
      fallbackModel = modelRuntime.getModel(fProv, options.fallbackModelId);
    }
  }

  return { modelRuntime, model, fallbackModel };
}
