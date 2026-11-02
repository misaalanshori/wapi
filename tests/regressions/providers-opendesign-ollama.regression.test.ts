import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initModelRuntime } from "../../src/model-runtime.js";
import { AgentSessionManager } from "../../src/agent-session-manager.js";
import { SessionRegistry } from "../../src/session-registry.js";
import { SessionGatekeeper } from "../../src/session-gatekeeper.js";
import Database from "better-sqlite3";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("OpenDesign & Ollama Integration Regression Suite", () => {
  let tmpDir: string;
  let registryDb: Database.Database;
  let registry: SessionRegistry;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `test-reg-prov-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    registryDb = new Database(path.join(tmpDir, "registry.sqlite"));
    registry = new SessionRegistry(registryDb);
  });

  afterEach(async () => {
    try {
      registryDb.close();
    } catch {
      // ignore
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("boots with opendesign provider and resolves models with vision and reasoning flags", async () => {
    const { modelRuntime, model } = await initModelRuntime({
      provider: "opendesign",
      providerApiKey: "sk-amr-test",
      providerModelId: "deepseek-v4.1-flash",
      agentHomeDir: tmpDir,
    });

    expect(model).toBeDefined();
    expect(model.id).toBe("deepseek-v4.1-flash");
    expect(model.provider).toBe("opendesign");
    expect(model.input).toContain("image");
    expect(model.reasoning).toBe(true);
  });

  it("boots with ollama and fallback ollama-cloud", async () => {
    const { model, fallbackModel } = await initModelRuntime({
      provider: "ollama",
      providerApiKey: "ollama",
      providerModelId: "llama3.2:latest",
      fallbackProvider: "ollama-cloud",
      fallbackModelId: "kimi-k2.5",
      fallbackApiKey: "cloud-key",
      agentHomeDir: tmpDir,
    });

    expect(model).toBeDefined();
    expect(model.id).toBe("llama3.2:latest");
    expect(model.provider).toBe("ollama");

    expect(fallbackModel).toBeDefined();
    expect(fallbackModel.id).toBe("kimi-k2.5");
    expect(fallbackModel.provider).toBe("ollama-cloud");
  });

  it("routes /ollama status and /ollama models through session gatekeeper to AgentSessionManager", async () => {
    const chatJid = "chat-ollama@g.us";
    const sessionRec = registry.createSession("sess-ollama-test", chatJid);

    const mockSession: any = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn(),
      getLastAssistantText: vi.fn().mockReturnValue("OK"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test", provider: "mock" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: mockSession }),
    });

    const gatekeeper = new SessionGatekeeper({
      secretWord: "secret123",
      registry,
      sessionExistsOnDisk: () => true,
      onOllamaCommand: async (cmd, jid) => {
        return manager.handleOllamaCommand(cmd, jid);
      },
    });

    const decision = await gatekeeper.handleMessage({
      chatJid,
      senderJid: "user@s.whatsapp.net",
      text: "/ollama status",
    });

    expect(decision.type).toBe("reply");
    if (decision.type === "reply") {
      expect(decision.text).toContain("Ollama Status");
      expect(decision.text).toContain("Local:");
      expect(decision.text).toContain("Cloud:");
    }
  });

  it("preserves custom active model in modelRuntime across AgentSession creation", async () => {
    const { modelRuntime, model } = await initModelRuntime({
      provider: "ollama",
      providerApiKey: "ollama",
      providerModelId: "lfm3-vl:2b-q8_0-128k",
      ollamaHost: "http://my-ollama-host:11434",
      agentHomeDir: tmpDir,
    });

    const mockSession: any = {
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model,
      modelRuntime,
      ollamaHost: "http://my-ollama-host:11434",
      sessionFactory: vi.fn().mockResolvedValue({ session: mockSession }),
    });

    expect(modelRuntime.getModel("ollama", "lfm3-vl:2b-q8_0-128k")).toBeDefined();

    // Create session which triggers default extension factories
    await manager.getOrCreateSession("sess-persist-test", "chat@s.whatsapp.net");

    // The model MUST still be defined and not wiped out
    const modelAfter = modelRuntime.getModel("ollama", "lfm3-vl:2b-q8_0-128k");
    expect(modelAfter).toBeDefined();
    expect(modelAfter?.id).toBe("lfm3-vl:2b-q8_0-128k");
    expect(modelAfter?.baseUrl).toBe("http://my-ollama-host:11434/v1");
    expect(modelAfter?.input).toContain("image");
  });
});
