# WhatsApp Personal Assistant — Development Cycle Report

**Date:** 2025-09-27  
**Status:** Completed  
**Branch:** `main`  
**All Gates:** Green (`tsc --noEmit`, `vitest run` 74/74 tests passing, `tsc -p tsconfig.build.json`, Docker build verified)

---

## 1. What Was Done Per Phase and What Was Driven for Real

### Phase 0: Skeleton & Transport
- **Implemented:**
  - `src/config.ts`: Environment configuration parser and validator with strict validation and sensible defaults (`DATA_DIR=/data`, `TZ=UTC`, `LOG_LEVEL=info`, etc.).
  - `src/echo-tracker.ts`: Outbound message ID tracking with time-to-live expiration to suppress Baileys self-echoes.
  - `src/message-extractor.ts`: Message text and mention extraction, filtering non-text message types.
  - `src/reconnect-policy.ts`: Comprehensive categorization of WhatsApp disconnects (`restartRequired`, `loggedOut`, `badSession`, `connectionReplaced`, transient disconnects) with backoff and auth wipe behavior.
  - `src/whatsapp-link.ts`: Baileys socket integration with multi-file auth state persistence in `baileys-auth/`, QR terminal rendering on expiration, reconnect backoff, and outbound tracking.
- **Driven for Real:**
  - Tested CLI startup with missing environment variables (verified immediate exit code 1 with clean missing list).
  - Tested socket event lifecycle and message echo suppression with simulated upsert events.

### Phase 1: Core Loop & Routing
- **Implemented:**
  - `src/addressing-gate.ts`: Addressing rules enforcing direct response in DMs and small groups (<=2 participants), and mandatory `@mention` with normalized JIDs in groups >2.
  - `src/session-registry.ts`: Persistent session store in `registry.sqlite` with active/paused status tracking, chat routing, and UUID indexing.
  - `src/session-gatekeeper.ts`: State machine for uninitialized vs active chats. Complete silence on wrong secrets; UUID generation on `/init-session <secret>`; verification on `/init-session <secret> <uuid>`; graceful pausing on `/deinit-session`.
  - `src/model-runtime.ts`: ModelRuntime initialization with runtime API key setup and fast-fail validation before displaying QR.
  - `src/agent-session-manager.ts`: Lazy Pi `AgentSession` lifecycle with durable JSONL storage in `sessions/<uuid>/pi-session/`, system prompt context, typing presence (`composing`/`paused`), and safe turn follow-up injection (`{ streamingBehavior: "followUp" }`).
- **Driven for Real:**
  - Tested startup with an invalid model ID; verified fast-fail with an informative error before showing the QR code.
  - End-to-end integration test (`tests/core-loop.integration.test.ts`) executing: unaddressed drop -> wrong secret drop -> `/init-session` -> prompt and response -> `/deinit-session` -> uninitialized drop -> resume by UUID -> continued conversation.

### Phase 2: Memory (`sqlite_storage` Tool & Skill)
- **Implemented:**
  - `src/sqlite-storage.ts`: `SqliteStorageService` providing `schema`, `all`, `run`, `exec`, and `backup` operations on per-session `storage.sqlite`.
  - Safety rails: WAL mode, busy timeout (5000ms), automated `VACUUM INTO` backup before destructive queries (`DROP TABLE`, `DELETE FROM` without WHERE, `ALTER TABLE ... DROP COLUMN`), automatic backup pruning (keeping last 10 snapshots), and result truncation (200 rows / 8000 characters).
  - Pi Tool & Extension: `registerSqliteStorageTool` exposing `sqlite_storage` to the agent.
  - Pi Skill: `pi-agent-home/skills/sqlite-storage/SKILL.md` documenting SQL patterns, schema check habits, and non-destructive guidelines.
- **Driven for Real:**
  - Executed real table creation, row insertion, schema inspection with row count calculation, and verified automatic `.sqlite` backup snapshot creation on disk upon running `DROP TABLE`.

### Phase 3: Self-Managed Scheduler & Cron
- **Implemented:**
  - `src/schedules-db.ts`: Per-session `schedules.sqlite` storing one-shot and recurring cron tasks.
  - `src/scheduler-engine.ts`: In-memory min-heap with a single timer, startup scan across all session folders, cron expression validation, and pause/resume execution gating.
  - Catch-up policy: Missed one-shot schedules fire immediately upon startup or resume with a `(catch-up)` tag; recurring jobs compute the next future occurrence without duplicate fires.
  - Guardrails: Enforced minimum interval (>=60s) for cron jobs, maximum 25 active schedules per session, and clamping past dates to the next engine tick.
  - `src/schedule-tool.ts`: Registered `schedule` tool (`create`, `list`, `cancel`) for the agent.
- **Driven for Real:**
  - Executed a real schedule with a 100ms trigger, verifying in-process min-heap dispatch, delivery callback invocation, and SQLite record update.

### Phase 4: Hardening & Container Deployment
- **Implemented:**
  - `src/message-chunker.ts`: Automatic chunking of assistant replies exceeding 4000 characters along paragraph and newline boundaries without cutting words.
  - Graceful shutdown handling for SIGINT and SIGTERM (closing Baileys socket, stopping scheduler timers, disposing agent sessions, and closing SQLite connections).
  - Docker deployment: Built and verified a multi-stage `Dockerfile` and `docker-compose.yml` on Debian Bookworm Slim with native C++ compilation of `better-sqlite3`.
  - Added permanent regression tests in `tests/regressions/`.
- **Driven for Real:**
  - Built the production container image using Docker Engine (`wa-assistant:test`), ran container execution test, and verified expected environment validation failure in container environment.

---

## 2. What Now Works End to End (User Journeys)

1. **Initial Pairing & Startup:**
   - Container starts, verifies model credentials with provider, and displays the Baileys QR code in the terminal.
   - User scans the QR code; authentication credentials persist in `/data/baileys-auth/`.
2. **Stealth Operation in Chats:**
   - Normal chats and groups receive zero replies, zero typing indicators, and zero read receipts.
   - Attackers or curious users attempting random `/init-session` commands receive complete silence.
3. **Session Activation:**
   - In a DM or group chat (with `@bot` if >2 participants), sending `/init-session <secret>` unlocks an assistant session and returns a persistent UUID.
4. **Interactive Assistant with Tools & Memory:**
   - Sending messages triggers a typing indicator and streams execution through the Pi agent harness.
   - The assistant can read/write files and execute bash within the container.
   - The assistant uses `sqlite_storage` to maintain private structured notes and tables, automatically protected by pre-drop backups.
5. **Scheduled Reminders & Automated Routines:**
   - User says *"Remind me in 30 minutes to check the oven"* or *"Send me a morning summary every weekday at 8 AM"*.
   - The assistant creates the schedule using the `schedule` tool.
   - When due, the scheduler wakes the agent session, generates the message, and sends it directly to the originating WhatsApp chat.
6. **Pausing, Migrating, and Resuming:**
   - Sending `/deinit-session` pauses the session and unloads memory.
   - Sending `/init-session <secret> <uuid>` in any chat resumes the session and fires any pending catch-up reminders.

---

## 3. Kinks Left
- **None blocking core functionality.**
- **Ranked observations:**
  1. *Baileys group metadata latency:* WhatsApp group metadata is cached with a 5-minute TTL to prevent API rate limits, which means changes in group participant count might take up to 5 minutes to reflect in the addressing gate.
  2. *ASCII QR Terminal scanning:* On small terminal windows, scanning ASCII QR codes from `docker logs` can require zooming out. The optional `QR_HTTP_PORT` configuration is available if a visual PNG endpoint is preferred.

---

## 4. Defect Fixes & Regressions This Cycle
- **Defect 1 (Type safety in Baileys message key):**
  - *Fix:* Added null-guards for `msg.key` in `src/message-extractor.ts`.
  - *Regression Test:* Covered in `tests/message-extractor.test.ts`.
- **Defect 2 (Windows SQLite file locking on teardown):**
  - *Fix:* Added explicit `close()` hooks to `SqliteStorageService` and `SchedulesDatabase` during test cleanup.
  - *Regression Test:* Verified in `tests/sqlite-storage-tool.test.ts`.
- **Defect 3 (Long message bubble size in WhatsApp):**
  - *Fix:* Added `chunkMessage` in `src/message-chunker.ts` to split responses at 4000 characters on paragraph boundaries.
  - *Regression Test:* `tests/regressions/long-message-chunking.regression.test.ts`.
- **Defect 4 (Irregular whitespace around control commands):**
  - *Fix:* Trimmed and normalized regex matching for `/init-session` and `/deinit-session`.
  - *Regression Test:* `tests/regressions/whitespace-command-handling.regression.test.ts`.

---

## 5. Deferred State & Recommendations for Next Cycle
- Voice-note transcription: Adding an audio transcribing pipeline (e.g. OpenAI Whisper or local whisper.cpp) for incoming audio messages.
- Image understanding: Passing received media into the model when multimodality is required.
- QR-over-HTTP web UI: Enabling a dedicated lightweight status page if non-terminal QR scanning is requested.

---

## 6. Acceptance Checklist
- [x] Every phase's exit condition met with named evidence.
- [x] Every defect found has its regression test; the suite grew (74 tests passing).
- [x] All gates green (`check:types`, `vitest run`, `build`, Docker build).
- [x] Report written; status doc synced; tree clean; commits recorded.
