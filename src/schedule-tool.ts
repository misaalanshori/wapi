import { Type } from "@sinclair/typebox";
import type { SchedulerEngine } from "./scheduler-engine.js";

export function registerScheduleTool(sessionId: string, engine: SchedulerEngine) {
  return (pi: any) => {
    pi.registerTool({
      name: "schedule",
      label: "Scheduler",
      description:
        "Self-managed scheduling for future wake-ups. Actions: create, list, cancel. A fired schedule sends its output straight to the WhatsApp chat.",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("create"),
          Type.Literal("list"),
          Type.Literal("cancel"),
        ]),
        kind: Type.Optional(
          Type.Union([Type.Literal("once"), Type.Literal("recurring")], {
            description: "Required for 'create': whether this schedule fires once or recurring",
          })
        ),
        prompt: Type.Optional(
          Type.String({
            description:
              "Required for 'create': the prompt to wake the assistant with when fired",
          })
        ),
        label: Type.Optional(
          Type.String({ description: "Human/agent-facing short name for this schedule" })
        ),
        cronExpr: Type.Optional(
          Type.String({
            description: "5-field cron expression for recurring schedules (e.g. '0 8 * * *')",
          })
        ),
        runAt: Type.Optional(
          Type.String({ description: "ISO 8601 UTC timestamp for once kind" })
        ),
        runInSeconds: Type.Optional(
          Type.Number({ description: "Relative seconds in future for once kind" })
        ),
        id: Type.Optional(
          Type.String({ description: "Required for 'cancel': the schedule ID to cancel" })
        ),
      }),
      execute: async (_toolCallId: string, params: any) => {
        try {
          switch (params.action) {
            case "create": {
              if (!params.kind) {
                return {
                  isError: true,
                  content: [{ type: "text", text: "Missing 'kind' parameter ('once' or 'recurring')" }],
                };
              }
              if (!params.prompt) {
                return {
                  isError: true,
                  content: [{ type: "text", text: "Missing 'prompt' parameter for create" }],
                };
              }

              const res = await engine.createSchedule(sessionId, {
                kind: params.kind,
                prompt: params.prompt,
                label: params.label,
                cronExpr: params.cronExpr,
                runAt: params.runAt,
                runInSeconds: params.runInSeconds,
              });

              return {
                content: [
                  {
                    type: "text",
                    text: `Schedule created successfully.\nID: ${res.id}\nKind: ${res.kind}\nNext fire at: ${res.nextFireAt}${res.label ? `\nLabel: ${res.label}` : ""}`,
                  },
                ],
              };
            }

            case "list": {
              const list = await engine.listSchedules(sessionId);
              if (list.length === 0) {
                return { content: [{ type: "text", text: "No active schedules for this session." }] };
              }
              const lines = list.map(
                (s) =>
                  `- [${s.id}] (${s.kind}${s.cronExpr ? ` "${s.cronExpr}"` : ""}) Next: ${s.nextFireAt}${s.label ? ` | Label: ${s.label}` : ""}\n  Prompt: "${s.prompt}"`
              );
              return {
                content: [
                  {
                    type: "text",
                    text: `Active schedules for this session:\n\n${lines.join("\n")}`,
                  },
                ],
              };
            }

            case "cancel": {
              if (!params.id) {
                return {
                  isError: true,
                  content: [{ type: "text", text: "Missing required 'id' parameter for cancel" }],
                };
              }
              await engine.cancelSchedule(sessionId, params.id);
              return {
                content: [{ type: "text", text: `Schedule ${params.id} canceled.` }],
              };
            }

            default:
              return {
                isError: true,
                content: [{ type: "text", text: `Unknown action: ${params.action}` }],
              };
          }
        } catch (err: any) {
          return {
            isError: true,
            content: [{ type: "text", text: err.message || String(err) }],
          };
        }
      },
    });
  };
}
