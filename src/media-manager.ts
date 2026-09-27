import fs from "fs/promises";
import path from "path";
import { downloadMediaMessage, type proto } from "@whiskeysockets/baileys";
import { unwrapMessageContent } from "./message-extractor.js";

export interface SavedMediaResult {
  filePath: string;
  base64Data: string;
  mimeType: string;
  fileName: string;
}

export interface SavedDocumentResult {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaManagerOptions {
  dataDir: string;
  maxMediaPerSession?: number;
  maxBytes?: number;
  downloadFn?: (rawMessage: proto.IWebMessageInfo) => Promise<Buffer>;
}

export class MediaManager {
  private readonly dataDir: string;
  private readonly maxMediaPerSession: number;
  private readonly maxBytes: number;
  private readonly downloadFn?: (rawMessage: proto.IWebMessageInfo) => Promise<Buffer>;

  constructor(options: MediaManagerOptions) {
    this.dataDir = options.dataDir;
    this.maxMediaPerSession = options.maxMediaPerSession ?? 50;
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024; // 10MB default
    this.downloadFn = options.downloadFn;
  }

  getMediaDir(sessionId: string): string {
    return path.join(this.dataDir, "sessions", sessionId, "media");
  }

  private mimeToExtension(mimeType: string): string {
    const base = mimeType.toLowerCase().split(";")[0]?.trim();
    switch (base) {
      case "image/jpeg":
      case "image/jpg":
        return ".jpg";
      case "image/png":
        return ".png";
      case "image/webp":
        return ".webp";
      case "image/gif":
        return ".gif";
      case "audio/ogg":
      case "audio/ogg; codecs=opus":
        return ".ogg";
      case "audio/mp4":
      case "audio/m4a":
        return ".m4a";
      default:
        return ".bin";
    }
  }

  async saveMedia(
    sessionId: string,
    messageId: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<SavedMediaResult> {
    if (buffer.length > this.maxBytes) {
      throw new Error(
        `Media buffer size (${buffer.length} bytes) exceeds maximum allowed size (${this.maxBytes} bytes)`
      );
    }

    const mediaDir = this.getMediaDir(sessionId);
    await fs.mkdir(mediaDir, { recursive: true });

    const ext = this.mimeToExtension(mimeType);
    const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `${safeId}${ext}`;
    const filePath = path.join(mediaDir, fileName);

    await fs.writeFile(filePath, buffer);
    await this.pruneMedia(sessionId);

    return {
      filePath,
      base64Data: buffer.toString("base64"),
      mimeType,
      fileName,
    };
  }

  async downloadAndSaveImage(
    sessionId: string,
    rawMessage: proto.IWebMessageInfo,
    sock?: any
  ): Promise<SavedMediaResult> {
    const msgId = rawMessage.key?.id || `img-${Date.now()}`;
    const unwrapped = unwrapMessageContent(rawMessage.message);
    const mimeType =
      unwrapped?.imageMessage?.mimetype ||
      unwrapped?.stickerMessage?.mimetype ||
      "image/jpeg";

    let buffer: Buffer;
    if (this.downloadFn) {
      buffer = await this.downloadFn(rawMessage);
    } else {
      buffer = await downloadMediaMessage(
        rawMessage as any,
        "buffer",
        {},
        {
          logger: undefined as any,
          reuploadRequest: sock?.updateMediaMessage,
        }
      );
    }

    return this.saveMedia(sessionId, msgId, buffer, mimeType);
  }

  async downloadAndSaveDocument(
    sessionId: string,
    rawMessage: proto.IWebMessageInfo,
    sock?: any
  ): Promise<SavedDocumentResult> {
    const unwrapped = unwrapMessageContent(rawMessage.message);
    const doc = unwrapped?.documentMessage;
    const rawFileName = doc?.fileName?.trim() || "document.bin";
    const mimeType = doc?.mimetype || "application/octet-stream";
    const msgId = rawMessage.key?.id || `doc-${Date.now()}`;

    let buffer: Buffer;
    if (this.downloadFn) {
      buffer = await this.downloadFn(rawMessage);
    } else {
      buffer = await downloadMediaMessage(
        rawMessage as any,
        "buffer",
        {},
        {
          logger: undefined as any,
          reuploadRequest: sock?.updateMediaMessage,
        }
      );
    }

    if (buffer.length > this.maxBytes) {
      throw new Error(`Document exceeds maximum allowed size of ${this.maxBytes} bytes`);
    }

    const mediaDir = this.getMediaDir(sessionId);
    await fs.mkdir(mediaDir, { recursive: true });

    const safeBaseName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileName = `${msgId}-${safeBaseName}`;
    const targetPath = path.join(mediaDir, fileName);

    await fs.writeFile(targetPath, buffer);
    await this.pruneMedia(sessionId);

    return {
      filePath: targetPath,
      fileName: safeBaseName,
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  private async pruneMedia(sessionId: string): Promise<void> {
    const mediaDir = this.getMediaDir(sessionId);
    try {
      const files = await fs.readdir(mediaDir);
      const mediaFiles: { name: string; mtime: number }[] = [];

      for (const file of files) {
        const filePath = path.join(mediaDir, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          mediaFiles.push({ name: file, mtime: stat.mtimeMs });
        }
      }

      // Sort newest first
      mediaFiles.sort((a, b) => b.mtime - a.mtime);

      if (mediaFiles.length > this.maxMediaPerSession) {
        const toDelete = mediaFiles.slice(this.maxMediaPerSession);
        for (const f of toDelete) {
          await fs.unlink(path.join(mediaDir, f.name)).catch(() => {});
        }
      }
    } catch {
      // non-fatal prune error
    }
  }
}
