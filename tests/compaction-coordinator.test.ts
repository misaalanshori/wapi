import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompactionCoordinator } from "../src/compaction-coordinator.js";

describe("CompactionCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start timer if token count is below soft limit", () => {
    const onCompact = vi.fn().mockResolvedValue(undefined);
    const coordinator = new CompactionCoordinator({
      softLimitTokens: 150000,
      idleMinutes: 15,
      targetTokens: 80000,
      headRatio: 1,
      tailRatio: 3,
      onCompact,
    });

    coordinator.recordTurnTokens("sess-1", 120000);
    expect(coordinator.hasActiveTimer("sess-1")).toBe(false);

    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(onCompact).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("starts idle timer when tokens exceed soft limit and triggers compaction after idle window", async () => {
    const onCompact = vi.fn().mockResolvedValue(undefined);
    const coordinator = new CompactionCoordinator({
      softLimitTokens: 150000,
      idleMinutes: 15,
      targetTokens: 80000,
      headRatio: 1,
      tailRatio: 3,
      onCompact,
    });

    coordinator.recordTurnTokens("sess-1", 160000);
    expect(coordinator.hasActiveTimer("sess-1")).toBe(true);

    // Advance 14 mins (should not fire yet)
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    expect(onCompact).not.toHaveBeenCalled();

    // Advance past 15 mins total
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(onCompact).toHaveBeenCalledWith(
      "sess-1",
      expect.stringContaining("Intelligent compaction"),
      60000 // 80k * (3/4)
    );
    coordinator.dispose();
  });

  it("resets idle timer if new activity occurs before timeout expires", async () => {
    const onCompact = vi.fn().mockResolvedValue(undefined);
    const coordinator = new CompactionCoordinator({
      softLimitTokens: 150000,
      idleMinutes: 15,
      targetTokens: 80000,
      headRatio: 1,
      tailRatio: 3,
      onCompact,
    });

    coordinator.recordTurnTokens("sess-1", 160000);

    // After 10 mins, new activity arrives (reset timer)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    coordinator.cancelTimer("sess-1");
    expect(coordinator.hasActiveTimer("sess-1")).toBe(false);

    // Another 10 mins pass (total 20 mins from original start, but cancelled)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(onCompact).not.toHaveBeenCalled();

    // Turn completes, re-evaluates tokens -> restarts 15m timer
    coordinator.recordTurnTokens("sess-1", 165000);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(onCompact).toHaveBeenCalledTimes(1);

    coordinator.dispose();
  });
});
