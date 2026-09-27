import { describe, it, expect, vi } from "vitest";
import { EchoTracker } from "../src/echo-tracker.js";

describe("EchoTracker", () => {
  it("tracks outbound message IDs and reports self-echo correctly", () => {
    const tracker = new EchoTracker(1000); // 1000ms TTL

    tracker.track("msg-1");
    expect(tracker.isSelfEcho("msg-1")).toBe(true);
    expect(tracker.isSelfEcho("msg-2")).toBe(false);
  });

  it("evicts IDs after TTL expires", () => {
    vi.useFakeTimers();
    try {
      const tracker = new EchoTracker(500); // 500ms TTL

      tracker.track("msg-1");
      expect(tracker.isSelfEcho("msg-1")).toBe(true);

      vi.advanceTimersByTime(501);
      expect(tracker.isSelfEcho("msg-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles null or undefined message IDs safely", () => {
    const tracker = new EchoTracker();
    expect(tracker.isSelfEcho(undefined)).toBe(false);
    expect(tracker.isSelfEcho(null)).toBe(false);
    expect(tracker.isSelfEcho("")).toBe(false);
  });
});
