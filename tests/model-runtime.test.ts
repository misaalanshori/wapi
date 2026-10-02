import { describe, it, expect, vi } from "vitest";
import { initModelRuntime } from "../src/model-runtime.js";

describe("initModelRuntime", () => {
  it("fast-fails if configured provider/model is not found", async () => {
    const mockRuntime = {
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn().mockReturnValue(null),
    };

    await expect(
      initModelRuntime({
        provider: "unknown-provider",
        providerApiKey: "key",
        providerModelId: "unknown-model",
        agentHomeDir: "/tmp/agent-home",
        runtimeFactory: async () => mockRuntime as any,
      })
    ).rejects.toThrow(/Configured model "unknown-provider\/unknown-model" was not found/);
  });

  it("succeeds and returns model and runtime when model resolves", async () => {
    const mockModel = { id: "my-model", provider: "my-provider" };
    const mockRuntime = {
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn().mockReturnValue(mockModel),
    };

    const result = await initModelRuntime({
      provider: "my-provider",
      providerApiKey: "secret-key",
      providerModelId: "my-model",
      agentHomeDir: "/tmp/agent-home",
      runtimeFactory: async () => mockRuntime as any,
    });

    expect(mockRuntime.setRuntimeApiKey).toHaveBeenCalledWith("my-provider", "secret-key");
    expect(result.model).toBe(mockModel);
    expect(result.modelRuntime).toBe(mockRuntime);
  });

  it("resolves both primary model and optional fallback model", async () => {
    const primaryModel = { id: "primary-model", provider: "my-provider" };
    const fallbackModel = { id: "fallback-model", provider: "my-provider" };

    const mockRuntime = {
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn((prov: string, id: string) => {
        if (id === "primary-model") return primaryModel;
        if (id === "fallback-model") return fallbackModel;
        return null;
      }),
    };

    const result = await initModelRuntime({
      provider: "my-provider",
      providerApiKey: "secret-key",
      providerModelId: "primary-model",
      fallbackModelId: "fallback-model",
      agentHomeDir: "/tmp/agent-home",
      runtimeFactory: async () => mockRuntime as any,
    });

    expect(result.model).toBe(primaryModel);
    expect(result.fallbackModel).toBe(fallbackModel);
  });
});
