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
- [x] Long reply chunking (~4000 chars on paragraph boundaries) (§8.3)
- [x] Graceful shutdown handlers (SIGINT, SIGTERM)
- [x] Dockerfile and docker-compose.yml verification (§10)
- [x] Acceptance checklist verification (§dev-rules.md)
- [x] Final report written (`docs/report.md`)

---

## Non-Text Media Phases (docs/media-processing-plan.md)

### Phase M1: Media Extractor & Audio Notice
- [x] Extend `src/message-extractor.ts` to support `text`, `image`, and `audio` message kinds
- [x] Extract image captions, mimetypes, and viewOnce wrapped images
- [x] Extract audio metadata (mimetype, seconds, ptt/voice note)
- [x] Handle audio notice in `SessionGatekeeper` (polite refusal when active/addressed, silent drop otherwise)
- [x] Phase M1 test suite passing

### Phase M2: Media Manager & File Persistence
- [x] Implement `src/media-manager.ts`
- [x] Download media via Baileys `downloadMediaMessage`
- [x] Persist files to `sessions/<uuid>/media/<messageId>.<ext>`
- [x] Enforce `MAX_MEDIA_PER_SESSION` rolling pruning
- [x] Return `{ filePath, base64Data, mimeType }` for model consumption
- [x] Phase M2 test suite passing

### Phase M3: Multimodal Prompting Integration
- [x] Update `AgentSessionManager.deliverMessage` to accept optional `images?: ImageContent[]`
- [x] Pass `images` to `session.prompt(text, { images, streamingBehavior: "followUp" })`
- [x] Wire image download and multimodal prompting into `src/index.ts`
- [x] Integration test for image message delivery
- [x] Phase M3 test suite passing

### Phase M4: Hardening & Regressions
- [x] Add regression tests (empty caption fallback, corrupted download handling, voice note in group)
- [x] Verify all gates (`check:types`, `vitest run`, `build`, Docker build)
- [x] Update `docs/journal.md` and `docs/report.md`

---

## Sender & Group Context Awareness (docs/sender-and-group-context-plan.md)
- [x] Phase C1: Message Extractor identity enrichment (`pushName`, phone number)
- [x] Phase C2: Group metadata subject caching & real-time invalidation
- [x] Phase C3: Turn attribution envelope & rich session preamble
- [x] Phase C4: Regression tests, typecheck, build, and deployment verification

---

## Conversational Context, Replies & Group Situational Awareness (docs/conversational-context-and-replies-plan.md)
- [x] Phase R1: Quoted message extraction & reply-to-bot addressing
- [x] Phase R2: Quoted message prompt attribution envelope
- [x] Phase R3: Rolling ambient group chatter buffer (last 15 messages)
- [x] Phase R4: Group roster & topic/description in session preamble
- [x] Phase R5: Verification, regression suite, and deployment

---

## Sticker Ingestion & Processing (docs/sticker-processing-plan.md)
- [x] Phase S1: Extract `stickerMessage` in `src/message-extractor.ts` as `kind: "image"` with `mimeType: "image/webp"`
- [x] Phase S2: Download and pass `.webp` stickers through `MediaManager` into `session.prompt()`
- [x] Phase S3: Quoted sticker image download & vision prompting when replying to stickers
- [x] Phase S4: Regression suite, typecheck, build, and deployment

---

## Document & General File Retrieval
- [x] Extract `documentMessage` (PDF, CSV, TXT, code, archives) with metadata (fileName, mimeType, fileLength)
- [x] Download and persist documents to `sessions/<uuid>/media/<msgId>-<safeFileName>`
- [x] Support quoted document messages with `[Quoted Document: ...]`
- [x] Installed `poppler-utils` (`pdftotext`), `curl`, `wget`, `python3` in Docker container
- [x] Regression test suite (`document-processing.regression.test.ts`), all gates green, deployed

---

## Outbound Media & File Sending (`send_file`)
- [x] Implemented `WhatsAppLink.sendFile` supporting images (`.png`, `.jpg`, `.webp`), audio (`.mp3`, `.ogg`, `.wav`), and documents (`.pdf`, `.csv`, `.docx`, etc.)
- [x] Created `send_file` tool registered per session with relative/absolute path resolution
- [x] Added `send_file` to agent session tools and updated system prompt preamble
- [x] Regression test suite (`send-file.regression.test.ts`), all gates green, deployed

---

## Intelligent Prompt Compaction (docs/intelligent-compaction-plan.md)
- [x] Created clean `.env.example` with documented environment variable schemas and default values
- [x] Configured 3-tier compaction parameters (`COMPACTION_SOFT_LIMIT_TOKENS`, `COMPACTION_IDLE_MINUTES`, `COMPACTION_TARGET_TOKENS`, `COMPACTION_HEAD_RATIO`, `COMPACTION_TAIL_RATIO`)
- [x] Built `CompactionCoordinator` managing 15-minute debounced idle timers that reset on active conversation
- [x] Implemented 1:3 Head-to-Tail preservation sandwich instructions, keeping ~60k tokens of verbatim tail and foundational head goals intact
- [x] Integrated background compaction queue into `AgentSessionManager` ensuring zero mid-turn collision
- [x] Regression test suite (`intelligent-compaction.regression.test.ts`), all gates green, deployed

---

## Fallback Model System & Dynamic Model Registration
- [x] Fixed `.gitignore` to un-ignore `.env.example`
- [x] Dynamic custom model registration (`ensureCustomModelInModelsJson`) so uncataloged models like `space-bunny-free` resolve
- [x] Configured primary model (`space-bunny-free`) and fallback model (`mimo-v2.6-flash`)
- [x] Seamless turn retry on fallback via `session.setModel()` preserving 100% transcript history
- [x] Automatic re-activation of primary model after session idle window (`COMPACTION_IDLE_MINUTES`)
- [x] Regression test suite (`fallback-model.regression.test.ts`), all gates green, deployed

---

## Session Status Command (`/session`)
- [x] Added `/session` command to `SessionGatekeeper` mirroring Pi TUI's session inspection
- [x] Implemented `AgentSessionManager.getSessionStatusSummary` querying native Pi `session.getSessionStats()` and `session.getContextUsage()`
- [x] Displays active context token usage, total prompt volume, cache hit rate, token counts, cost estimate, and active schedules
- [x] Fixed session persistence across Docker restarts: `SessionManager.open(meta.piSessionFile)` / `continueRecent()` instead of `SessionManager.create()`
- [x] Unit tests and regression suite green, deployed

---

## Active Turn Steering (`/steer`)
- [x] Added `/steer <instructions>` command to `SessionGatekeeper`
- [x] Standard addressing support (`/steer` in DMs, `@bot /steer` or swipe-to-reply in groups)
- [x] Wired to Pi's native `session.steer()` during active streaming turns, injecting prompt before next tool call
- [x] Fallback to normal delivery when session is idle
- [x] Regression test suite (`steering.regression.test.ts`), all gates green, deployed

---

## Live Mid-Turn Progress Streaming & In-Place Message Editing
- [x] Implemented `WhatsAppLink.editMessage` using native Baileys protocol edit payload
- [x] Subscribed `AgentSessionManager` to Pi turn lifecycle detecting `stopReason: "toolUse"`
- [x] Dispatches initial progress bubble on first tool call and edits in-place on subsequent steps
- [x] Configurable debounce threshold (`PROGRESS_MIN_STEPS` default 3, `PROGRESS_MIN_SECONDS` default 90): tasks finishing within 3 turns or under 90s do not emit progress bubbles
- [x] Edits to `✅ _Completed (N turns)_` on turn settlement and dispatches final response as separate message
- [x] Single-turn Q&A without tool calls does not create progress bubbles
- [x] Regression test suite (`mid-turn-progress.regression.test.ts`), all gates green, deployed

---

## Image Pipeline Disambiguation & Quoted Media Tracking
- [x] Injected explicit `[Attached Image: ... saved at ...]` path into prompt text so the agent always correlates vision tokens with the exact local disk file
- [x] Injected explicit `[Quoted Image: ... saved at ...]` when replying to images or stickers
- [x] Regression test suite (`image-pipeline.regression.test.ts`), all gates green, deployed

---

## Preinstalled Container Tooling Suite
- [x] Preinstalled all requested system APT tools (`tmux`, `ffmpeg`, `imagemagick`, `tesseract-ocr`, `tesseract-ocr-ind`, `jq`, `yq`, `ripgrep`, `fd-find`, `fzf`, `sqlite3`, `unzip`, `zip`, `p7zip-full`, `pandoc`, `poppler-utils`, `qpdf`, `dnsutils`, `whois`, `nmap`, `netcat-openbsd`, `mtr-tiny`, `traceroute`, `httpie`, `wget`, `curl`, `aria2`, `lynx`, `w3m`, `tree`, `file`, `bc`, `xxd`, `hexdump`, `rsync`, `zstd`, `brotli`, `htop`, `espeak-ng`, `sox`, `python3-pip`, `python3-venv`)
- [x] Linked `/usr/local/bin/fd` -> `/usr/bin/fdfind`
- [x] Preinstalled Python automation & research stack (`playwright`, `requests>=2.32`, `httpx`, `beautifulsoup4`, `lxml`, `lxml_html_clean`, `trafilatura`, `pandas`, `openpyxl`, `matplotlib`, `pillow`, `pytesseract`, `pyyaml`, `rich`, `tqdm`, `selenium`)
- [x] Preinstalled Chromium browser & dependencies for Playwright (`python3 -m playwright install --with-deps chromium`) with `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`
- [x] Preinstalled global Node packages (`playwright`, `ws`, `axios`, `cheerio`) with `NODE_PATH=/usr/local/lib/node_modules`
- [x] Verified tool execution, test suites green, Docker deployed
