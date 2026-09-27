import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerSendFileTool } from "../../src/send-file-tool.js";
import { detectMimeType } from "../../src/whatsapp-link.js";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Send File Tool Regression Suite", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `test-reg-sendfile-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("detects mime types for common file extensions correctly", () => {
    expect(detectMimeType("document.pdf")).toBe("application/pdf");
    expect(detectMimeType("photo.png")).toBe("image/png");
    expect(detectMimeType("photo.jpg")).toBe("image/jpeg");
    expect(detectMimeType("sticker.webp")).toBe("image/webp");
    expect(detectMimeType("data.csv")).toBe("text/csv");
    expect(detectMimeType("song.mp3")).toBe("audio/mpeg");
    expect(detectMimeType("archive.zip")).toBe("application/zip");
    expect(detectMimeType("unknown.xyz123")).toBe("application/octet-stream");
  });

  it("executes send_file tool for session-relative file and returns confirmation", async () => {
    let registeredTool: any;
    const mockPi = {
      registerTool: (tool: any) => {
        registeredTool = tool;
      },
    };

    const mockSender = {
      sendFile: vi.fn().mockResolvedValue("msg-sent-456"),
    };

    const filePath = path.join(tmpDir, "report.pdf");
    await fs.writeFile(filePath, "%PDF-1.4 content");

    const factory = registerSendFileTool("chat-123@g.us", tmpDir, mockSender);
    factory(mockPi);

    const result = await registeredTool.execute("call-1", {
      filePath: "report.pdf",
      caption: "Summary report",
      fileName: "custom-report.pdf",
    });

    expect(mockSender.sendFile).toHaveBeenCalledWith("chat-123@g.us", {
      filePath,
      caption: "Summary report",
      fileName: "custom-report.pdf",
    });
    expect(result.content[0].text).toContain("File successfully sent to WhatsApp");
    expect(result.content[0].text).toContain("report.pdf");
  });

  it("safely handles non-existent file path returning error result", async () => {
    let registeredTool: any;
    const mockPi = {
      registerTool: (tool: any) => {
        registeredTool = tool;
      },
    };

    const mockSender = { sendFile: vi.fn() };
    const factory = registerSendFileTool("chat-123@g.us", tmpDir, mockSender);
    factory(mockPi);

    const result = await registeredTool.execute("call-2", {
      filePath: "missing-file.csv",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("File not found on disk");
  });
});
