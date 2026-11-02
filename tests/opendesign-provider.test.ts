import { describe, it, expect, vi } from "vitest";
import {
  OPENDESIGN_PROVIDER_ID,
  OPENDESIGN_BASE_URL,
  DEFAULT_OPENDESIGN_MODELS,
  createOpenDesignProviderConfig,
  refreshOpenDesignModels,
  createOpenDesignExtension,
} from "../src/providers/opendesign.js";
import { initModelRuntime } from "../src/model-runtime.js";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("OpenDesign Provider & Extension", () => {
  it("provides complete OpenDesign provider configuration and default models", () => {
    const config = createOpenDesignProviderConfig();
    expect(config.name).toBe("OpenDesign");
    expect(config.baseUrl).toBe(OPENDESIGN_BASE_URL);
    expect(config.api).toBe("openai-completions");
    expect(Array.isArray(config.models)).toBe(true);
    expect(config.models.length).toBe(11);

    const flash = config.models.find((m: any) => m.id === "deepseek-v4.1-flash");
    expect(flash).toBeDefined();
    expect(flash?.contextWindow).toBe(1048000);
    expect(flash?.maxTokens).toBe(32000);
    expect(flash?.reasoning).toBe(true);
    expect(flash?.input).toEqual(["text", "image"]);

    const mimo = config.models.find((m: any) => m.id === "mimo-v2.6-flash");
    expect(mimo).toBeDefined();
    expect(mimo?.contextWindow).toBe(1048000);
  });

  it("registers opendesign provider via extension factory", () => {
    const mockPi = {
      registerProvider: vi.fn(),
    };
    const extension = createOpenDesignExtension();
    extension(mockPi as any);

    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      OPENDESIGN_PROVIDER_ID,
      expect.objectContaining({
        name: "OpenDesign",
        baseUrl: OPENDESIGN_BASE_URL,
      })
    );
  });

  it("resolves opendesign provider and models in ModelRuntime", async () => {
    const tmpDir = path.join(os.tmpdir(), `test-od-runtime-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const { modelRuntime, model, fallbackModel } = await initModelRuntime({
        provider: "opendesign",
        providerApiKey: "sk-test-opendesign",
        providerModelId: "deepseek-v4.1-flash",
        fallbackProvider: "opendesign",
        fallbackModelId: "mimo-v2.6-flash",
        fallbackApiKey: "sk-test-opendesign",
        agentHomeDir: tmpDir,
      });

      expect(model).toBeDefined();
      expect(model.id).toBe("deepseek-v4.1-flash");
      expect(model.provider).toBe("opendesign");
      expect(model.contextWindow).toBe(1048000);

      expect(fallbackModel).toBeDefined();
      expect(fallbackModel.id).toBe("mimo-v2.6-flash");
      expect(fallbackModel.provider).toBe("opendesign");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("fetches dynamic models when refreshOpenDesignModels is called", async () => {
    const mockData = {
      data: [
        {
          id: "custom-model-1",
          enabled: true,
          architecture: { input_modalities: ["text", "image"] },
          metadata: { context_limit: 500000, output_budget: 16000 },
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    } as any);

    const models = await refreshOpenDesignModels(
      {
        allowNetwork: true,
        credential: { type: "api_key", key: "sk-test" },
      } as any,
      "https://api.test/v1"
    );

    expect(fetchSpy).toHaveBeenCalled();
    expect(models.length).toBe(1);
    expect(models[0].id).toBe("custom-model-1");
    expect(models[0].contextWindow).toBe(500000);
    expect(models[0].maxTokens).toBe(16000);
    expect(models[0].input).toEqual(["text", "image"]);

    fetchSpy.mockRestore();
  });
});
