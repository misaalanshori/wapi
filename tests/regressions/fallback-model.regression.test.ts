import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initModelRuntime } from "../../src/model-runtime.js";
import { AgentSessionManager } from "../../src/agent-session-manager.js";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Fallback Model Regression Suite", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `test-reg-fallback-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("dynamically registers custom model like space-bunny-free into models.json when not built-in", async () => {
    const result = await initModelRuntime({
      provider: "opencode-go",
      providerApiKey: "mock-key",
      providerModelId: "space-bunny-free",
      agentHomeDir: tmpDir,
    });

    expect(result.model).toBeDefined();
    expect(result.model.id).toBe("space-bunny-free");

    const modelsRaw = await fs.readFile(path.join(tmpDir, "models.json"), "utf8");
    const modelsConfig = JSON.parse(modelsRaw);
    expect(
      modelsConfig.providers["opencode-go"].models.some((m: any) => m.id === "space-bunny-free")
    ).toBe(true);
  });

  it("automatically falls back on primary error and reverts after idle period", async () => {
    const primaryModel = { id: "space-bunny-free", provider: "opencode-go" };
    const fallbackModel = { id: "mimo-v2.6-flash", provider: "opencode-go" };

    let promptCount = 0;
    const mockSession: any = {
      prompt: vi.fn(async () => {
        promptCount++;
        if (promptCount === 1) {
          throw new Error("Space-bunny-free capacity reached");
        }
      }),
      setModel: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("Fallback answered"),
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: primaryModel as any,
      fallbackModel: fallbackModel as any,
      fallbackCheckIdleMs: 40,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: mockSession }),
    });

    const mockSender = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("m1"),
    };

    // 1. Initial prompt fails on primary -> switches to fallback
    const res = await manager.deliverMessage("sess-fb", "chat@s.whatsapp.net", "hello", mockSender);
    expect(mockSession.setModel).toHaveBeenCalledWith(fallbackModel);
    expect(res).toBe("Fallback answered");

    // 2. Idle window passes (>40ms)
    await new Promise((r) => setTimeout(r, 50));

    // 3. Next message reverts back to primary
    await manager.deliverMessage("sess-fb", "chat@s.whatsapp.net", "hello again", mockSender);
    expect(mockSession.setModel).toHaveBeenCalledWith(primaryModel);
  });
});
