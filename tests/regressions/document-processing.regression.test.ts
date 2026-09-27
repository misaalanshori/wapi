import { describe, it, expect } from "vitest";
import { extractMessageInfo } from "../../src/message-extractor.js";
import { MediaManager } from "../../src/media-manager.js";
import type { proto } from "@whiskeysockets/baileys";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Document Processing Regression Suite", () => {
  it("extracts documentMessage with fileName and size metadata", () => {
    const msg: proto.IWebMessageInfo = {
      key: {
        remoteJid: "123456789@s.whatsapp.net",
        id: "doc-reg-1",
        fromMe: false,
      },
      message: {
        documentMessage: {
          fileName: "contract.pdf",
          mimetype: "application/pdf",
          fileLength: 204800,
          caption: "Please review",
        },
      },
    };

    const info = extractMessageInfo(msg);
    expect(info?.kind).toBe("document");
    expect(info?.text).toBe("Please review");
    expect(info?.mediaInfo?.fileName).toBe("contract.pdf");
    expect(info?.mediaInfo?.fileLength).toBe(204800);
  });

  it("MediaManager downloads and saves document safely without path traversal", async () => {
    const tmpDir = path.join(os.tmpdir(), `test-doc-reg-${Date.now()}`);
    const mockBuffer = Buffer.from("%PDF-1.4 mock pdf bytes");
    const manager = new MediaManager({
      dataDir: tmpDir,
      downloadFn: async () => mockBuffer,
    });

    const msg: any = {
      key: { id: "doc-clean-id" },
      message: {
        documentMessage: {
          fileName: "../../etc/passwd.pdf",
          mimetype: "application/pdf",
        },
      },
    };

    const saved = await manager.downloadAndSaveDocument("sess-doc", msg);
    expect(saved.fileName).toBe("passwd.pdf");
    expect(saved.filePath).toContain(path.join("sess-doc", "media", "doc-clean-id-passwd.pdf"));

    const content = await fs.readFile(saved.filePath);
    expect(content.toString()).toBe("%PDF-1.4 mock pdf bytes");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
