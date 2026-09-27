import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MediaManager } from "../src/media-manager.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("MediaManager", () => {
  let tmpDir: string;
  let manager: MediaManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapi-mediamgr-"));
    manager = new MediaManager({
      dataDir: tmpDir,
      maxMediaPerSession: 3,
      maxBytes: 1024 * 1024, // 1MB
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves media buffer to sessions/<uuid>/media/<messageId>.<ext>", async () => {
    const sessionId = "uuid-med-1";
    const messageId = "msg-999";
    const sampleBuffer = Buffer.from("fake-jpeg-data");

    const result = await manager.saveMedia(sessionId, messageId, sampleBuffer, "image/jpeg");

    expect(result.filePath).toContain(path.join("sessions", sessionId, "media", "msg-999.jpg"));
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.base64Data).toBe(sampleBuffer.toString("base64"));

    const exists = await fs.access(result.filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const savedContent = await fs.readFile(result.filePath);
    expect(savedContent).toEqual(sampleBuffer);
  });

  it("prunes oldest media files when exceeding maxMediaPerSession", async () => {
    const sessionId = "uuid-prune";

    for (let i = 0; i < 5; i++) {
      await manager.saveMedia(
        sessionId,
        `msg-${i}`,
        Buffer.from(`data-${i}`),
        "image/png"
      );
      // Ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 10));
    }

    const mediaDir = path.join(tmpDir, "sessions", sessionId, "media");
    const files = await fs.readdir(mediaDir);

    expect(files.length).toBeLessThanOrEqual(3);
  });

  it("downloads and saves image using provided download function", async () => {
    const sessionId = "uuid-dl";
    const mockBuffer = Buffer.from("downloaded-image-bytes");
    const mockDownloadFn = vi.fn().mockResolvedValue(mockBuffer);

    const customManager = new MediaManager({
      dataDir: tmpDir,
      downloadFn: mockDownloadFn,
    });

    const mockRawMsg: any = {
      key: { id: "dl-msg-1" },
      message: {
        imageMessage: {
          mimetype: "image/png",
        },
      },
    };

    const res = await customManager.downloadAndSaveImage(sessionId, mockRawMsg);

    expect(mockDownloadFn).toHaveBeenCalledWith(mockRawMsg);
    expect(res.base64Data).toBe(mockBuffer.toString("base64"));
    expect(res.mimeType).toBe("image/png");
    expect(res.filePath).toContain("dl-msg-1.png");
  });

  it("downloads and saves sticker message with webp mimetype", async () => {
    const sessionId = "uuid-stk-dl";
    const mockBuffer = Buffer.from("webp-sticker-bytes");
    const mockDownloadFn = vi.fn().mockResolvedValue(mockBuffer);

    const customManager = new MediaManager({
      dataDir: tmpDir,
      downloadFn: mockDownloadFn,
    });

    const mockRawMsg: any = {
      key: { id: "stk-msg-1" },
      message: {
        stickerMessage: {
          mimetype: "image/webp",
        },
      },
    };

    const res = await customManager.downloadAndSaveImage(sessionId, mockRawMsg);

    expect(mockDownloadFn).toHaveBeenCalledWith(mockRawMsg);
    expect(res.base64Data).toBe(mockBuffer.toString("base64"));
    expect(res.mimeType).toBe("image/webp");
    expect(res.filePath).toContain("stk-msg-1.webp");
  });

  it("rejects image exceeding maxBytes limit", async () => {
    const sessionId = "uuid-oversized";
    const bigBuffer = Buffer.alloc(2 * 1024 * 1024); // 2MB > 1MB limit

    await expect(
      manager.saveMedia(sessionId, "big-msg", bigBuffer, "image/jpeg")
    ).rejects.toThrow(/exceeds maximum allowed size/);
  });
});
