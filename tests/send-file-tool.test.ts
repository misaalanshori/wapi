import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerSendFileTool } from "../src/send-file-tool.js";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("registerSendFileTool", () => {
  let tmpDir: string;
  let mockPi: any;
  let registeredTool: any;
  let mockWaLink: any;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `test-send-file-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    mockWaLink = {
      sendFile: vi.fn().mockResolvedValue("msg-file-123"),
    };

    mockPi = {
      registerTool: vi.fn((tool) => {
        registeredTool = tool;
      }),
      on: vi.fn(),
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("registers send_file tool with correct schema", () => {
    const factory = registerSendFileTool("chat-1@s.whatsapp.net", tmpDir, mockWaLink);
    factory(mockPi);

    expect(mockPi.registerTool).toHaveBeenCalled();
    expect(registeredTool.name).toBe("send_file");
    expect(registeredTool.parameters.properties.filePath).toBeDefined();
  });

  it("sends file when file exists on disk", async () => {
    const factory = registerSendFileTool("chat-1@s.whatsapp.net", tmpDir, mockWaLink);
    factory(mockPi);

    const testFilePath = path.join(tmpDir, "test-report.pdf");
    await fs.writeFile(testFilePath, "%PDF-1.4 sample content");

    const result = await registeredTool.execute("call-1", {
      filePath: "test-report.pdf",
      caption: "Here is your report",
      fileName: "custom-report.pdf",
    });

    expect(mockWaLink.sendFile).toHaveBeenCalledWith("chat-1@s.whatsapp.net", {
      filePath: testFilePath,
      caption: "Here is your report",
      fileName: "custom-report.pdf",
    });
    expect(result.content[0].text).toContain("File successfully sent");
  });

  it("returns error result when file does not exist", async () => {
    const factory = registerSendFileTool("chat-1@s.whatsapp.net", tmpDir, mockWaLink);
    factory(mockPi);

    const result = await registeredTool.execute("call-2", {
      filePath: "non-existent-file.pdf",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("File not found");
  });
});
