import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSessionManager } from "../src/agent-session-manager.js";
import { MediaManager } from "../src/media-manager.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Multimodal Prompting Integration", () => {
  let tmpDir: string;
  let mockWaLink: any;
  let mockAgentSession: any;
  let mediaManager: MediaManager;
  let lastPromptOptions: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-multimodal-"));
    mockWaLink = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("msg-reply-1"),
    };
    mockAgentSession = {
      prompt: vi.fn().mockImplementation(async (_text, options) => {
        lastPromptOptions = options;
      }),
      getLastAssistantText: vi.fn().mockReturnValue("I see a beautiful sunset in the image!"),
      dispose: vi.fn(),
    };

    mediaManager = new MediaManager({
      dataDir: tmpDir,
      downloadFn: async () => Buffer.from("image-binary-payload"),
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("downloads image, passes ImageContent to session.prompt, and returns assistant reply", async () => {
    const manager = new AgentSessionManager({
      dataDir: tmpDir,
      sharedAgentDir: path.join(tmpDir, "agent-home"),
      model: { id: "test-vision-model" } as any,
      modelRuntime: {} as any,
      sessionFactory: vi.fn().mockResolvedValue({ session: mockAgentSession }),
    });

    const sessionId = "uuid-vision";
    const chatJid = "chat-vision@s.whatsapp.net";

    const mockRawMsg: any = {
      key: { id: "img-msg-001", remoteJid: chatJid },
      message: {
        imageMessage: {
          caption: "What is this scene?",
          mimetype: "image/jpeg",
        },
      },
    };

    // 1. Download and save media
    const saved = await mediaManager.downloadAndSaveImage(sessionId, mockRawMsg);
    expect(saved.base64Data).toBe(Buffer.from("image-binary-payload").toString("base64"));

    // 2. Deliver message with images
    const images = [
      {
        type: "image" as const,
        data: saved.base64Data,
        mimeType: saved.mimeType,
      },
    ];

    const reply = await manager.deliverMessage(
      sessionId,
      chatJid,
      "What is this scene?",
      mockWaLink,
      images
    );

    expect(mockAgentSession.prompt).toHaveBeenCalledWith("What is this scene?", {
      images,
      streamingBehavior: "followUp",
    });
    expect(lastPromptOptions?.images).toHaveLength(1);
    expect(lastPromptOptions?.images[0].data).toBe(saved.base64Data);
    expect(reply).toBe("I see a beautiful sunset in the image!");
    expect(mockWaLink.sendMessage).toHaveBeenCalledWith(chatJid, "I see a beautiful sunset in the image!");
  });
});
