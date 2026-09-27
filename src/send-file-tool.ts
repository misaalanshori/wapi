import { Type } from "@sinclair/typebox";
import path from "path";
import fs from "fs/promises";

export interface SendFilePayload {
  filePath: string;
  caption?: string;
  fileName?: string;
}

export interface SendFileSender {
  sendFile: (chatJid: string, payload: SendFilePayload) => Promise<string>;
}

export function registerSendFileTool(
  chatJid: string,
  sessionDir: string,
  sender: SendFileSender
) {
  return (pi: any) => {
    pi.registerTool({
      name: "send_file",
      label: "Send File to WhatsApp",
      description:
        "Send a local file, image, document (PDF, CSV, TXT, etc.), or audio back to the active WhatsApp chat.",
      parameters: Type.Object({
        filePath: Type.String({
          description:
            "Absolute or session-relative path of the file to send (e.g. 'report.pdf' or '/data/sessions/.../file.png')",
        }),
        caption: Type.Optional(
          Type.String({ description: "Optional caption text to accompany the file or image" })
        ),
        fileName: Type.Optional(
          Type.String({
            description: "Optional custom file name for document attachments (e.g. 'summary.pdf')",
          })
        ),
      }),
      execute: async (_toolCallId: string, params: { filePath: string; caption?: string; fileName?: string }) => {
        try {
          const resolvedPath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.resolve(sessionDir, params.filePath);

          try {
            await fs.access(resolvedPath);
          } catch {
            return {
              isError: true,
              content: [{ type: "text", text: `File not found on disk at: ${resolvedPath}` }],
            };
          }

          const messageId = await sender.sendFile(chatJid, {
            filePath: resolvedPath,
            caption: params.caption,
            fileName: params.fileName,
          });

          return {
            content: [
              {
                type: "text",
                text: `File successfully sent to WhatsApp (${path.basename(resolvedPath)}, ID: ${messageId})`,
              },
            ],
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Failed to send file to WhatsApp: ${err?.message || String(err)}`,
              },
            ],
          };
        }
      },
    });
  };
}
