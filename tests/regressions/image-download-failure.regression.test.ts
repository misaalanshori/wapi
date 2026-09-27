import { describe, it, expect } from "vitest";
import { MediaManager } from "../../src/media-manager.js";

describe("Regression: Image download failure must throw clean error and not crash", () => {
  it("rejects with descriptive error when download fails", async () => {
    const manager = new MediaManager({
      dataDir: "/tmp/data",
      downloadFn: async () => {
        throw new Error("WhatsApp network socket disconnected during media stream");
      },
    });

    const mockRawMsg: any = {
      key: { id: "fail-msg" },
      message: { imageMessage: { mimetype: "image/jpeg" } },
    };

    await expect(
      manager.downloadAndSaveImage("sess-fail", mockRawMsg)
    ).rejects.toThrow(/WhatsApp network socket disconnected/);
  });
});
