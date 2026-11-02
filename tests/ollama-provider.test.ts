import { describe, it, expect, vi } from "vitest";
import {
  OLLAMA_PROVIDER_ID,
  OLLAMA_CLOUD_PROVIDER_ID,
  DEFAULT_LOCAL_URL,
  DEFAULT_CLOUD_URL,
  normalizeOllamaUrl,
  getContextLengthFromName,
  hasReasoningCapability,
  hasVisionCapability,
  createOllamaProviderConfig,
  createOllamaCloudProviderConfig,
  createOllamaExtension,
} from "../src/providers/ollama.js";
import { initModelRuntime } from "../src/model-runtime.js";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Ollama Provider & Extension", () => {
  it("normalizes diverse Ollama host strings to valid /v1 HTTP URLs", () => {
    expect(normalizeOllamaUrl("http://lan-ollama-host:11434")).toBe("http://lan-ollama-host:11434/v1");
    expect(normalizeOllamaUrl("http://lan-ollama-host:11434/")).toBe("http://lan-ollama-host:11434/v1");
    expect(normalizeOllamaUrl("http://lan-ollama-host:11434/v1")).toBe("http://lan-ollama-host:11434/v1");
    expect(normalizeOllamaUrl("lan-ollama-host:11434")).toBe("http://lan-ollama-host:11434/v1");
    expect(normalizeOllamaUrl("0.0.0.0")).toBe("http://127.0.0.1:11434/v1");
    expect(normalizeOllamaUrl("0.0.0.0:11434")).toBe("http://127.0.0.1:11434/v1");
    expect(normalizeOllamaUrl("127.0.0.1")).toBe("http://127.0.0.1:11434/v1");
    expect(normalizeOllamaUrl("localhost")).toBe("http://localhost:11434/v1");
  });

  it("resolves context lengths accurately by model family name", () => {
    expect(getContextLengthFromName("deepseek-v4-flash")).toBe(1048576);
    expect(getContextLengthFromName("kimi-k2.5")).toBe(262144);
    expect(getContextLengthFromName("qwen3-72b")).toBe(262144);
    expect(getContextLengthFromName("minimax-m2.5")).toBe(204800);
    expect(getContextLengthFromName("glm-4")).toBe(202752);
    expect(getContextLengthFromName("llama3.2:latest")).toBe(128000);
    expect(getContextLengthFromName("deepseek-r1:14b")).toBe(163840);
    expect(getContextLengthFromName("qwen2.5:7b")).toBe(32768);
    expect(getContextLengthFromName("unknown-random-model")).toBe(131072);
  });

  it("detects reasoning capabilities correctly", () => {
    expect(hasReasoningCapability("deepseek-r1:14b")).toBe(true);
    expect(hasReasoningCapability("qwq:32b")).toBe(true);
    expect(hasReasoningCapability("gpt-oss:latest")).toBe(true);
    expect(hasReasoningCapability("phi-4:latest")).toBe(true);
    expect(hasReasoningCapability("my-reasoning-model")).toBe(true);
    expect(hasReasoningCapability("llama3.2:latest")).toBe(false);
    expect(hasReasoningCapability("qwen2.5-coder:7b")).toBe(false);
  });

  it("detects vision capabilities accurately for VL models", () => {
    expect(hasVisionCapability("lfm3-vl:2b-q8_0-128k")).toBe(true);
    expect(hasVisionCapability("lfm3-vl:2b-q8_0")).toBe(true);
    expect(hasVisionCapability("qwen2.5-vl:7b")).toBe(true);
    expect(hasVisionCapability("llava:13b")).toBe(true);
    expect(hasVisionCapability("llama3.2-vision:11b")).toBe(true);
    expect(hasVisionCapability("llama3.2:3b")).toBe(false);
    expect(hasVisionCapability("qwen2.5:7b")).toBe(false);

    // Capabilities fallback
    expect(hasVisionCapability("custom-model", ["vision", "tools"])).toBe(true);
    expect(hasVisionCapability("custom-model", ["completion"])).toBe(false);
  });

  it("registers both local and cloud ollama providers via extension factory", async () => {
    const mockPi = {
      registerProvider: vi.fn(),
      registerCommand: vi.fn(),
    };

    const extension = createOllamaExtension({
      baseUrl: "http://localhost:11434",
      cloudUrl: "https://ollama.com",
      apiKey: "test-cloud-key",
    });

    await extension(mockPi as any);

    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      OLLAMA_PROVIDER_ID,
      expect.objectContaining({
        baseUrl: "http://localhost:11434/v1",
        api: "openai-completions",
      })
    );

    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      OLLAMA_CLOUD_PROVIDER_ID,
      expect.objectContaining({
        baseUrl: "https://ollama.com/v1",
        api: "openai-completions",
      })
    );

    expect(mockPi.registerCommand).toHaveBeenCalledWith("ollama-status", expect.any(Object));
    expect(mockPi.registerCommand).toHaveBeenCalledWith("ollama-models", expect.any(Object));
    expect(mockPi.registerCommand).toHaveBeenCalledWith("ollama-info", expect.any(Object));
    expect(mockPi.registerCommand).toHaveBeenCalledWith("ollama", expect.any(Object));
  });

  it("resolves ollama and ollama-cloud in ModelRuntime", async () => {
    const tmpDir = path.join(os.tmpdir(), `test-ollama-runtime-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const { model, fallbackModel } = await initModelRuntime({
        provider: "ollama",
        providerApiKey: "dummy-key",
        providerModelId: "qwen2.5:latest",
        fallbackProvider: "ollama-cloud",
        fallbackModelId: "kimi-k2.5",
        fallbackApiKey: "test-cloud-key",
        agentHomeDir: tmpDir,
      });

      expect(model).toBeDefined();
      expect(model.id).toBe("qwen2.5:latest");
      expect(model.provider).toBe("ollama");

      expect(fallbackModel).toBeDefined();
      expect(fallbackModel.id).toBe("kimi-k2.5");
      expect(fallbackModel.provider).toBe("ollama-cloud");
      expect(fallbackModel.contextWindow).toBe(262144);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
