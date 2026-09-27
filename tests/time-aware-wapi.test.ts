import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSessionManager } from "../src/agent-session-manager.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Time-Aware WAPI Integration", () => {
  let tmpDir: string;
  let mockWaLink: any;
  let mockAgentSession: any;
  let capturedExtensionFactories: any[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-timeaware-"));
    capturedExtensionFactories = [];
    mockWaLink = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("msg-sent-id"),
    };
    mockAgentSession = {
      prompt: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue(
        "Here is the report you requested.\n\n<TimeAware>Time is 2026-09-27T12:00:00.000Z (2 minutes since session started, just now since previous message)</TimeAware>"
      ),
      dispose: vi.fn(),
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("strips <TimeAware> tags from outbound WhatsApp messages so user never sees them", async () => {
    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-model" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockImplementation(async (opts) => {
        capturedExtensionFactories = opts.resourceLoader?.options?.extensionFactories || [];
        return { session: mockAgentSession };
      }),
    });

    const reply = await manager.deliverMessage(
      "session-ta-1",
      "chat-ta@s.whatsapp.net",
      "Give me the report",
      mockWaLink
    );

    // 1. WhatsApp sendMessage receives cleaned text
    expect(mockWaLink.sendMessage).toHaveBeenCalledWith(
      "chat-ta@s.whatsapp.net",
      "Here is the report you requested."
    );

    // 2. No TimeAware tags leak to WhatsApp
    const sentText = mockWaLink.sendMessage.mock.calls[0][1];
    expect(sentText).not.toContain("<TimeAware>");
    expect(sentText).not.toContain("</TimeAware>");
  });
});
