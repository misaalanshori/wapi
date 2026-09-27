import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerScheduleTool } from "../src/schedule-tool.js";

describe("registerScheduleTool", () => {
  let mockEngine: any;
  let registeredTool: any;
  let mockPi: any;

  beforeEach(() => {
    mockEngine = {
      createSchedule: vi.fn().mockResolvedValue({ id: "sched-123", nextFireAt: "2026-01-01T08:00:00.000Z" }),
      listSchedules: vi.fn().mockResolvedValue([
        { id: "sched-123", label: "Briefing", kind: "recurring", cronExpr: "0 8 * * *", nextFireAt: "2026-01-01T08:00:00.000Z" },
      ]),
      cancelSchedule: vi.fn().mockResolvedValue(undefined),
    };

    mockPi = {
      registerTool: vi.fn().mockImplementation((tool) => {
        registeredTool = tool;
      }),
    };

    const factory = registerScheduleTool("session-abc", mockEngine);
    factory(mockPi);
  });

  it("registers tool schedule", () => {
    expect(mockPi.registerTool).toHaveBeenCalled();
    expect(registeredTool.name).toBe("schedule");
    expect(registeredTool.execute).toBeTypeOf("function");
  });

  it("executes create, list, and cancel actions", async () => {
    // create
    const createRes = await registeredTool.execute("call-1", {
      action: "create",
      kind: "recurring",
      cronExpr: "0 8 * * *",
      prompt: "Daily briefing",
      label: "Briefing",
    });
    expect(createRes.isError).toBeFalsy();
    expect(mockEngine.createSchedule).toHaveBeenCalledWith("session-abc", expect.objectContaining({
      kind: "recurring",
      cronExpr: "0 8 * * *",
      prompt: "Daily briefing",
      label: "Briefing",
    }));

    // list
    const listRes = await registeredTool.execute("call-2", { action: "list" });
    expect(listRes.isError).toBeFalsy();
    expect(listRes.content[0].text).toContain("sched-123");

    // cancel
    const cancelRes = await registeredTool.execute("call-3", {
      action: "cancel",
      id: "sched-123",
    });
    expect(cancelRes.isError).toBeFalsy();
    expect(mockEngine.cancelSchedule).toHaveBeenCalledWith("session-abc", "sched-123");
  });
});
