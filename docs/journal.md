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

## 2025-09-27 — Phase 2 Complete
- Implemented Phase 2 via TDD:
  - `src/sqlite-storage.ts`: `SqliteStorageService` supporting `schema`, `all`, `run`, `exec`, `backup`.
  - Safety rails: WAL mode, busy timeout 5000ms, auto-backup before destructive SQL (`DROP TABLE`, `DELETE FROM` without WHERE, `ALTER TABLE ... DROP COLUMN`), backup pruning to maxBackups (default 10), result truncation (200 rows / 8000 chars).
  - Pi extension tool registration: `registerSqliteStorageTool` exposing the `sqlite_storage` tool.
  - Pi Skill file: `pi-agent-home/skills/sqlite-storage/SKILL.md` specifying database design habits, schema inspection, and upsert usage.
  - Wired into `AgentSessionManager` to register `sqlite_storage` on each session's own private `storage.sqlite`.
  - Driven verification: Tested table creation, parameterized queries, row count reporting, and auto-backup creation on disk.
  - All gates green: `check:types`, `test` (56 tests passing), `build`.

## 2025-09-27 — Phase 3 Complete
- Implemented Phase 3 via TDD:
  - `src/schedules-db.ts`: `SchedulesDatabase` for per-session `schedules.sqlite` (CRUD, enabled state, fire updates).
  - `src/scheduler-engine.ts`: In-memory min-heap with single `setTimeout`, scanning `DATA_DIR/sessions/*/schedules.sqlite` on startup.
  - Guardrails: enforced interval check (>= 60s) for cron expressions, max 25 schedules per session, clamping past dates to now.
  - Catch-up policy: one-shot missed tasks fire with `(catch-up)` tag upon resume or startup; recurring schedules advance to next future occurrence without duplicate fires.
  - State gating: paused sessions in `registry.sqlite` have schedule execution safely skipped.
  - `src/schedule-tool.ts`: Registered `schedule` tool (`create`, `list`, `cancel`) for Pi agent sessions.
  - Driven verification: Created live schedule in temporary session directory, verified timer firing, callback delivery, and SQLite record update.
  - All gates green: `check:types`, `test` (67 tests passing), `build`.

## 2025-09-27 — Phase 4 & Cycle Complete
- Implemented Phase 4 via TDD:
  - `src/message-chunker.ts`: Clean splitting of long assistant outputs at ~4000 char paragraph and line boundaries, ensuring comfortable bubble length without truncation.
  - Added named permanent regression tests in `tests/regressions/`:
    - `long-message-chunking.regression.test.ts`: Verifies messages >4000 characters chunk into multiple bubbles without dropping text.
    - `whitespace-command-handling.regression.test.ts`: Verifies resilient handling of irregular whitespace and newlines around `/init-session` and `/deinit-session`.
  - Docker deployment verified: Multi-stage `Dockerfile` and `docker-compose.yml` created and built with `docker build`, verified container startup fast-fail and execution in Debian Bookworm Slim with native SQLite3/Better-SQLite3.
  - All gates green: `check:types`, `test` (74 tests passing), `build`.
  - Wrote cycle close-out report in `docs/report.md`.

## 2025-09-27 — Non-Text Media (Images & Audio) Complete
- Implemented media processing plan according to `docs/media-processing-plan.md` via TDD:
  - Phase M1: Extended `src/message-extractor.ts` to detect `image` and `audio` kinds, unpack viewOnce messages, and extract audio metadata. Updated `SessionGatekeeper` to deliver polite refusal notice for audio/voice notes in active chats while maintaining complete silence in uninitialized/unaddressed chats.
  - Phase M2: Implemented `src/media-manager.ts` to download WhatsApp media, persist binary files to `sessions/<uuid>/media/<messageId>.<ext>`, enforce `maxBytes` (10MB) bounds, and roll-prune to `maxMediaPerSession` (50).
  - Phase M3: Extended `AgentSessionManager.deliverMessage` to accept optional `ImageContent[]` and pass multimodal images to `session.prompt(text, { images, streamingBehavior: "followUp" })`. Connected image download and fallback prompting in `src/index.ts`.
  - Phase M4: Added permanent regression tests for empty captions, voice note group tags, and download error recovery. Verified Docker container build.
  - All gates green: `check:types`, `test` (90 tests passing), `build`.

## 2026-09-27 — pi-time-aware Extension Wired to WAPI
- Installed `pi-time-aware` via GitHub dependency (`github:misaalanshori/pi-time-aware`).
- Added `defaultTimeAwareExtension` to default extension factories in `AgentSessionManager.getOrCreateSession`.
- Added `stripTimeAwareTags(reply)` in `deliverMessage` before WhatsApp chunking and transmission, ensuring `<TimeAware>` tags enrich the agent's context without leaking to the user.
- Verified Docker build with multi-stage npm git resolution.
- All gates green: `check:types`, `test` (91 tests passing), `build`.

## 2026-09-27 — Architecture Plan: Sender & Group Context Awareness
- Authored comprehensive plan in `docs/sender-and-group-context-plan.md` to enrich LLM prompts with:
  - Sender identity (`pushName`, formatted international phone number, and owner indicator).
  - Chat context (group subject/title, group JID, participant count, DM vs Group).
  - Rich session system prompt preambles and per-turn conversational attribution headers `[From: ... in "..."]: <text>`.
  - Phased TDD implementation strategy across 4 phases (C1–C4).
  - Completed all phases C1–C4: 29 test files, 108 tests passing, Docker deployed.

## 2026-09-27 — Synchronization & Concurrency Hardening
- Root cause:
  1. WhatsApp client auto-cancels `"composing"` presence after 10–15 seconds of inactivity. During long tool runs (e.g. bash queries), typing bubble disappeared.
  2. Concurrent messages for the same chat invoked `session.prompt()` in parallel while turn was active. Second prompt returned immediately with previous turn's text or empty, while the real turn finished silently in the background until the next prompt called `getLastAssistantText()`.
- Fixes implemented:
  - **Presence Heartbeat:** `AgentSessionManager` sets a 7-second heartbeat repeating `sendPresenceUpdate("composing")` throughout the entire prompt lifecycle until `"paused"`.
  - **Per-Session FIFO Queue:** `sessionQueues` promise chain ensures messages arriving for the same session are processed strictly sequentially in FIFO order without overlapping turns or stale text extraction.
  - **Parallelism preserved:** Independent sessions/chats process concurrently without blocking each other.
  - All 30 test files, 119 tests passing. Deployed to Docker.
