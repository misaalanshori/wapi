import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompactionCoordinator } from "../../src/compaction-coordinator.js";
import { AgentSessionManager } from "../../src/agent-session-manager.js";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Intelligent Compaction Regression Suite", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    tmpDir = path.join(os.tmpdir(), `test-reg-compaction-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("calculates 1:3 head:tail ratio parameters correctly", () => {
    const coordinator = new CompactionCoordinator({
      softLimitTokens: 150000,
      idleMinutes: 15,
      targetTokens: 80000,
      headRatio: 1,
      tailRatio: 3,
      onCompact: vi.fn(),
    });

    const params = coordinator.buildSandwichParameters();
    expect(params.keepRecentTokens).toBe(60000); // 80k * (3 / 4)
    expect(params.instructions).toContain("Intelligent compaction sandwich");
    expect(params.instructions).toContain("# Initial Context & Goals");
    expect(params.instructions).toContain("# Intermediate Summary");
    expect(params.instructions).toContain("60000 tokens");
    coordinator.dispose();
  });

  it("automatically compacts session in background after soft limit and idle window", async () => {
    const mockCompact = vi.fn().mockResolvedValue(undefined);
    const mockSession: any = {
      prompt: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("Done"),
      getContextUsage: vi.fn().mockReturnValue({ tokens: 165000, contextWindow: 1000000 }),
      compact: mockCompact,
      dispose: vi.fn(),
    };

    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test", provider: "mock" } as any,
      modelRuntime: {} as any,
      compactionConfig: {
        softLimitTokens: 150000,
        idleMinutes: 15,
        targetTokens: 80000,
        headRatio: 1,
        tailRatio: 3,
      },
      sessionFactory: vi.fn().mockResolvedValue({ session: mockSession }),
    });

    const mockSender = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("msg-1"),
    };

    // 1. Deliver turn that puts token count at 165k (exceeding soft limit 150k)
    await manager.deliverMessage("sess-comp", "chat-1@s.whatsapp.net", "hello", mockSender);

    // 2. Idle window passes (14 mins: no compaction yet)
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    expect(mockCompact).not.toHaveBeenCalled();

    // 3. 15 mins passes: background compaction triggers!
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mockCompact).toHaveBeenCalledTimes(1);
    expect(mockCompact).toHaveBeenCalledWith(
      expect.stringContaining("Intelligent compaction sandwich")
    );

    await manager.disposeAll();
  });
});
