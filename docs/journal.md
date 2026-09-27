# Development Journal

## 2025-09-27 — Cycle Start & Phase 0 Complete
- Initialized project environment: Node 24 ESM, TypeScript, Vitest, Baileys, Pi SDK, Better-SQLite3, Pino.
- Created `status.md`, `journal.md`, `report.md`.
- Implemented Phase 0 via TDD:
  - `src/config.ts`: Config loading, strict validation of required credentials, defaults.
  - `src/echo-tracker.ts`: Outbound message ID cache with TTL expiration to suppress Baileys self-echo.
  - `src/message-extractor.ts`: Robust text and mention extraction, ignoring media/unsupported types.
  - `src/reconnect-policy.ts`: Comprehensive disconnect categorization and backoff/wipe decision engine.
  - `src/whatsapp-link.ts`: Baileys socket lifecycle, QR terminal rendering, multi-file auth persistence, reconnects, outbound message tracking.
  - Gates verified green: `check:types`, `test` (19 tests passing), `build`.
  - Driven verification: Tested startup with missing env (exits 1 with clear missing variable list) and valid env.

## 2025-09-27 — Phase 1 Complete
- Implemented Phase 1 via TDD:
  - `src/addressing-gate.ts`: Filtering DMs, small groups (<=2), and >2 participant groups via `@mention` with normalized JIDs.
  - `src/session-registry.ts`: `registry.sqlite` schema and CRUD operations (create, find, pause, resume into new chat, touch, list).
  - `src/session-gatekeeper.ts`: State machine for uninitialized vs active chats, secret validation, UUID extraction and validation, `/init-session`, `/deinit-session`.
  - `src/agent-session-manager.ts`: Lazy Pi `AgentSession` lifecycle, directory structure, prompt delivery with `{ streamingBehavior: "followUp" }`, presence typing indicators, and session disposal.
  - `src/model-runtime.ts`: ModelRuntime creation, runtime API key setting, and startup fast-fail validation if model ID is invalid.
  - `tests/core-loop.integration.test.ts`: End-to-end integration test verifying addressing -> init -> chat -> deinit -> resume.
  - Driven verification: Tested startup with invalid model ID, verifying fast-fail before QR display.
  - All gates green: `check:types`, `test` (45 tests passing), `build`.
