import path from "path";
import fs from "fs/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ModelRuntimeInitOptions {
  provider: string;
  providerApiKey: string;
  providerModelId: string;
  agentHomeDir: string;
  runtimeFactory?: (options: { authPath: string; modelsPath: string }) => Promise<ModelRuntime>;
}

export interface ModelRuntimeInitResult {
  modelRuntime: ModelRuntime;
  model: any;
}

export async function initModelRuntime(
  options: ModelRuntimeInitOptions
): Promise<ModelRuntimeInitResult> {
  const { provider, providerApiKey, providerModelId, agentHomeDir } = options;

  await fs.mkdir(agentHomeDir, { recursive: true });
  const authPath = path.join(agentHomeDir, "auth.json");
  const modelsPath = path.join(agentHomeDir, "models.json");

  const factory = options.runtimeFactory ?? ((opts) => ModelRuntime.create(opts));
  const modelRuntime = await factory({ authPath, modelsPath });

  await modelRuntime.setRuntimeApiKey(provider, providerApiKey);

  const model = modelRuntime.getModel(provider, providerModelId);
  if (!model) {
    throw new Error(
      `Configured model "${provider}/${providerModelId}" was not found. ` +
        `Check PROVIDER / PROVIDER_MODEL_ID before the QR will be shown.`
    );
  }

  return { modelRuntime, model };
}
