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
