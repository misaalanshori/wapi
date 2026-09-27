# Implementation Status

**Authoritative Spec:** `docs/wa-assistant-srd.md`  
**Reference Implementations:** `../Baileys`, `../pi`  
**Gates:** `npm run check:types` (`tsc --noEmit`), `npm test` (`vitest run`), `npm run build` (`tsc -p tsconfig.build.json`)  
**Regressions Location:** `tests/regressions/`  
**Journal:** `docs/journal.md`  
**Report:** `docs/report.md`  

---

## Settled Decisions
1. **Runtime & Language:** Node.js 24 + TypeScript (ESM, strict mode).
2. **Test Runner:** Vitest with strict TDD (write failing test first, verify all gates before commit).
3. **Single Owner, Single WhatsApp Account, Single Container:** Scoped to one Baileys multi-device pairing.
4. **Data Isolation:** All data in `DATA_DIR` (`/data` by default). `storage.sqlite` and `schedules.sqlite` per session; `registry.sqlite` for routing.
5. **Fail-safe Addressing & Gatekeeping:** Uninitialized chats produce zero response on wrong secrets. Groups >2 require `@mention` of the bot.

---

## Phase Checklist

### Phase 0: Skeleton
- [x] Config loading and validation (`SECRET_WORD`, `PROVIDER`, `PROVIDER_API_KEY`, `PROVIDER_MODEL_ID`, optional vars)
- [x] Baileys connection lifecycle & reconnect policy (§8.1)
- [x] Outbound message ID tracking & self-echo suppression (§8.1)
- [x] Text extraction from incoming WhatsApp messages (§8.1)
- [x] QR code display handling via `qrcode-terminal` (§8.1)
- [x] Structured logging setup with Pino (§8.1, §11)
- [x] Phase 0 test suite passing

### Phase 1: Core Loop
- [x] Addressing Gate logic: DMs, small groups (<=2), large groups (>2 with @mention) (§8.2.1)
- [x] Session Registry (`registry.sqlite`): schema, CRUD, status management (§8.2.2)
- [x] Session Gatekeeper: `/init-session <secret> [uuid]` and `/deinit-session` (§8.2.2)
- [x] ModelRuntime initialization & model resolution fast-fail at startup (§8.3)
- [x] Agent Session Manager: lazy instantiation of Pi `AgentSession`, prompt injection with `followUp`, typing presence (`composing`/`paused`), outbound send (§8.3)
- [x] Phase 1 test suite passing

### Phase 2: Memory
- [x] `sqlite_storage` tool implementation (§8.4)
  - `schema`, `all`, `run`, `exec`, `backup` actions
  - Auto-backup on destructive statements (pruned to last N)
  - Result row & character truncation limits
  - WAL mode & busy timeout
- [x] Skill file at `pi-agent-home/skills/sqlite-storage/SKILL.md` (§8.4)
- [x] Phase 2 test suite passing

### Phase 3: Scheduler
- [x] Schedules database (`schedules.sqlite`) per session (§8.5.2)
- [x] In-process Scheduler Engine min-heap + single timer (§8.5.3)
- [x] Catch-up policy on startup and resume (§8.5.4)
- [x] Scheduler guardrails (`MIN_SCHEDULE_INTERVAL_SECONDS`, `MAX_SCHEDULES_PER_SESSION`) (§8.5.5)
- [x] `schedule` tool (`create`, `list`, `cancel`) (§8.5.6)
- [x] Integration with pause/resume and delivery loop (§8.5.3, §8.5.4)
- [x] Phase 3 test suite passing

### Phase 4: Hardening & Verification
- [ ] Long reply chunking (~4000 chars on paragraph boundaries) (§8.3)
- [ ] Graceful shutdown handlers (SIGINT, SIGTERM)
- [ ] Dockerfile and docker-compose.yml verification (§10)
- [ ] Acceptance checklist verification (§dev-rules.md)
- [ ] Final report written (`docs/report.md`)
