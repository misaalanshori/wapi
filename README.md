# WAPI — WhatsApp Personal AI Assistant

> A private, single-tenant, containerized personal AI assistant operating inside WhatsApp. Powered by [Baileys](https://github.com/WhiskeySockets/Baileys) and the [Pi Agent SDK](https://github.com/earendil-works/pi), featuring isolated SQLite memory, autonomous self-scheduling, multimodal media handling, time-awareness, and intelligent prompt compaction.

---

## Table of Contents

1. [Overview & Motivation](#overview--motivation)
2. [Key Architecture & Features](#key-architecture--features)
   - [WhatsApp Multi-Device Link (Baileys)](#1-whatsapp-multi-device-link-baileys)
   - [Addressing Gate & Session Gatekeeper](#2-addressing-gate--session-gatekeeper)
   - [Isolated Persistent SQLite Memory (`sqlite_storage`)](#3-isolated-persistent-sqlite-memory-sqlite_storage)
   - [Self-Scheduling & Cron Wake-Ups (`schedule`)](#4-self-scheduling--cron-wake-ups-schedule)
   - [Multimodal Ingestion & Outbound File Delivery (`send_file`)](#5-multimodal-ingestion--outbound-file-delivery-send_file)
   - [Contextual Awareness: Quoting, Replies & Ambient Buffer](#6-contextual-awareness-quoting-replies--ambient-buffer)
   - [Time Awareness (`pi-time-aware`)](#7-time-awareness-pi-time-aware)
   - [Intelligent 3-Tier Prompt Compaction](#8-intelligent-3-tier-prompt-compaction)
   - [Synchronization & Concurrency Hardening](#9-synchronization--concurrency-hardening)
3. [WhatsApp Chat Commands](#whatsapp-chat-commands)
4. [Storage & Directory Layout](#storage--directory-layout)
5. [Getting Started & Local Deployment](#getting-started--local-deployment)
   - [Prerequisites](#prerequisites)
   - [Configuration (`.env`)](#configuration-env)
   - [Running with Docker Compose](#running-with-docker-compose)
   - [Pairing via QR Code](#pairing-via-qr-code)
   - [Unlocking Chats](#unlocking-chats)
6. [Development & Testing Discipline](#development--testing-discipline)

---

## Overview & Motivation

Most AI chat solutions rely on hosted, multi-tenant web interfaces, proprietary cloud bots, or closed SaaS bridges. **WAPI** was engineered to be a truly personal, private companion:

- **Self-Hosted & Single-Tenant:** Runs entirely on your own machine or private VPS inside a single Docker container.
- **Your WhatsApp Account:** Connects directly via WhatsApp Multi-Device (Web protocol), acting as a linked device under your control.
- **Zero Cloud Amnesia:** Maintains permanent per-session SQLite databases, JSONL transcripts, and autonomous cron timers that survive container restarts.
- **Indistinguishable Silence:** Unregistered or unauthorized chats produce zero response. The bot remains invisible and silent until unlocked with a secret passphrase.
- **Extensible Tooling:** The agent has native shell access inside its container (`bash`, `read`, `write`, `edit`, `pdftotext`, `python3`, `sqlite3`), enabling it to inspect files, execute scripts, and send documents back to your chat.

---

## Key Architecture & Features

```
                                ┌──────────────────────────────────────────────┐
                                │            WhatsApp Cloud / Network          │
                                └──────────────────────┬───────────────────────┘
                                                       │ WebSocket
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│  WAPI Container                                                                             │
│                                                                                             │
│  ┌───────────────────────┐         ┌─────────────────────────┐      ┌────────────────────┐  │
│  │     WhatsAppLink      │ ──────> │     Addressing Gate     │ ───> │ SessionGatekeeper  │  │
│  │ (Baileys Web Client)  │         │ (DM vs Group / Mentions)│      │  (registry.sqlite) │  │
│  └───────────────────────┘         └─────────────────────────┘      └─────────┬──────────┘  │
│             ▲                                                                 │             │
│             │ send_file / chunked replies                                     ▼             │
│  ┌──────────┴────────────┐         ┌─────────────────────────┐      ┌────────────────────┐  │
│  │   SchedulerEngine     │ <─────> │   AgentSessionManager   │ <──> │  Pi AgentSession   │  │
│  │  (schedules.sqlite)   │         │ (FIFO Queues, Heartbeat)│      │ (LLM / Tool Loop)  │  │
│  └───────────────────────┘         └─────────────────────────┘      └─────────┬──────────┘  │
│                                                                               │             │
│                                         ┌─────────────────────────────────────┴──────────┐  │
│                                         ▼                                                ▼  │
│                              ┌─────────────────────┐                          ┌──────────┴┐ │
│                              │   sqlite_storage    │                          │ send_file │ │
│                              │  (storage.sqlite)   │                          │ (Outbound)│ │
│                              └─────────────────────┘                          └───────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. WhatsApp Multi-Device Link (Baileys)
- Connects using `@whiskeysockets/baileys` as a secondary linked device.
- **Signal Key Caching:** Signal identity keys are cached in memory (`makeCacheableSignalKeyStore`) to avoid filesystem bottlenecks during rapid end-to-end encryption/decryption.
- **Self-Echo Suppression:** Tracks all outbound message IDs in an `EchoTracker` to prevent the bot from replying to its own messages.
- **Protocol Version Negotiation:** Queries and uses the latest WhatsApp Web client version dynamically on startup.
- **Retry Protection:** Persistent `msgRetryCounterCache` prevents infinite decryption/retry loops with WhatsApp servers across reconnects.

### 2. Addressing Gate & Session Gatekeeper
- **Direct Messages (1:1):** Always addressed; responds directly.
- **Small Groups (<= 2 participants):** Treated like DMs; no mention required.
- **Large Groups (> 2 participants):** Requires an explicit `@mention` or a swipe-to-reply to the bot.
- **LID & Phone Dual-Resolution:** Automatically detects and resolves both phone numbers (`@s.whatsapp.net`) and privacy Linked IDs (`@lid`).
- **Silent by Default:** Uninitialized chats drop messages completely. Wrong passphrases produce zero response, making the bot indistinguishable from an inactive account.

### 3. Isolated Persistent SQLite Memory (`sqlite_storage`)
Each chat session has a completely private, isolated SQLite database (`sessions/<uuid>/storage.sqlite`):
- Runs in **WAL mode** (Write-Ahead Logging) with a 5000ms busy timeout.
- Exposes structured actions: `schema`, `all` (with row and character safety caps), `run`, `exec`, and `backup`.
- **Pre-Destructive Auto-Backups:** Automatically snapshots the database into `storage-backups/` before executing destructive DDL/DML statements (`DROP TABLE`, `DELETE FROM` without `WHERE`, `ALTER TABLE ... DROP COLUMN`).

### 4. Self-Scheduling & Cron Wake-Ups (`schedule`)
Sessions manage their own future execution via an in-process min-heap scheduler:
- **One-off Reminders:** Relative delays (`runInSeconds: 300`) or ISO 8601 targets (`runAt: "2026-09-27T15:00:00+07:00"`).
- **Recurring Cron:** Standard 5-field cron syntax (`cronExpr: "0 8 * * *"`), enforcing a >= 60-second minimum interval and max 25 schedules per session.
- **Guaranteed Catch-Up:** Missed schedules during container downtime fire immediately upon resume.
- Fired schedules awaken the assistant with the scheduled prompt and deliver the reply directly to the originating WhatsApp chat.

### 5. Multimodal Ingestion & Outbound File Delivery (`send_file`)
- **Images:** Ingests JPG, PNG, and WebP images (including view-once media) and feeds base64 image data to the multimodal LLM.
- **Stickers:** Detects static and animated WhatsApp stickers (`stickerMessage`), persists `.webp` binaries, and attaches them for vision reasoning.
- **Documents & PDFs:** Receives any file attachment (`documentMessage`), safely saves it to `sessions/<uuid>/media/<id>-<name>`, and informs the agent of the local file path.
- **Container Tooling:** The container includes `poppler-utils` (`pdftotext`, `pdfinfo`), `curl`, `wget`, `python3`, and `sqlite3`, enabling the agent to parse PDFs, run Python scripts, and fetch external assets via `bash`.
- **Outbound `send_file` Tool:** The agent can send files back to WhatsApp:
  - `.png`, `.jpg`, `.webp`, `.gif` → Sent as native WhatsApp photos with optional captions.
  - `.mp3`, `.ogg`, `.wav`, `.m4a` → Sent as native WhatsApp audio.
  - `.pdf`, `.csv`, `.docx`, `.zip`, `.txt` → Sent as downloadable WhatsApp document attachments with custom file names.

### 6. Contextual Awareness: Quoting, Replies & Ambient Buffer
- **Reply/Quote Extraction:** When a user replies to a message, the assistant receives the quoted text and sender:
  ```text
  [Replying to Alice (+628111111): "Deploying v2.1 tonight"]
  [From: M Isa (+6283820039330) in "Dev Ops"]: @bot what time is that in Jakarta?
  ```
- **Swipe-to-Reply Trigger:** Swiping to reply to the bot in a group counts as addressed without needing an `@bot` text tag.
- **Ambient Chatter Ring Buffer:** Maintains an in-memory 15-message rolling window of unaddressed group conversation. When addressed, it provides the recent backlog so the bot understands questions like *"what were they just discussing?"* or *"summarize above"*.
- **Group Metadata in Preamble:** Injects the group title, description/topic, and admin phone numbers into the session system prompt.

### 7. Time Awareness (`pi-time-aware`)
Integrated with [`pi-time-aware`](https://github.com/misaalanshori/pi-time-aware):
- Suffix injection (tail placement) ensures dynamic timestamps never invalidate LLM prompt prefix caches.
- Recovers true session creation timestamps and message intervals from Pi transcript history on resume.
- Clocks tool execution times and formats timezones natively via `Intl.DateTimeFormat` (e.g. `Asia/Jakarta`).

### 8. Intelligent 3-Tier Prompt Compaction
Solves the problem of LLM providers dropping their 5-minute KV prompt cache between intermittent daily messages:
- **Tier 1 (Below 150k tokens):** Zero compaction. Verbatim history is preserved.
- **Tier 2 (>= 150k tokens + 15 mins silence):** Starts a 15-minute countdown that resets on every new message (never interrupts live chat). Runs in the background during silence.
- **1:3 Head/Tail Sandwich:** Compacts down toward `~80k tokens`:
  - **Tail (~60k tokens / 3 parts):** Preserved **100% verbatim** via Pi's native `keepRecentTokens`.
  - **Head (~20k tokens / 1 part):** Foundational goals and initial user instructions are extracted and pinned into the summary header (`# Initial Context & Goals`).
  - **Middle:** Intermediate chatter and tool outputs are compressed.
- **Tier 3 (Hard Net):** Pi's built-in ~950k emergency compaction catches runaway tasks.
- **100% Append-Only:** Compaction appends a `CompactionEntry` to the `.jsonl` transcript. Zero historical entries on disk are ever deleted.

### 9. Synchronization & Concurrency Hardening
- **Presence Heartbeat:** WhatsApp auto-cancels typing bubbles after 10–15 seconds. WAPI runs a 7-second heartbeat renewing `sendPresenceUpdate("composing")` throughout long LLM thinking and tool runs.
- **Per-Session FIFO Queue:** Messages within the same chat execute strictly in sequential order, preventing race conditions or stale text extraction.
- **Cross-Chat Parallelism:** Distinct WhatsApp chats run in parallel without blocking each other.
- **Strict Session File Persistence:** Pins `meta.piSessionFile` across Docker restarts, preventing orphaned session files.

---

## WhatsApp Chat Commands

| Command | Scope | Description |
|---|---|---|
| `/init-session <secret> [uuid]` | Any chat | Unlocks and activates the bot in this chat. Optionally resumes a specific session UUID. |
| `/deinit-session` | Active chat | Pauses the session and unlinks it from the chat. The bot returns to silent drop mode. |
| `/session` | Active chat | Displays real-time session diagnostics: active context tokens, total prompt volume, cache hit rate, token counts, cost estimate, and active schedules. |
| `/steer <instructions>` | Active chat | Injects a real-time steering message into the active turn at the next tool boundary (e.g. `/steer you can stop now`). |

*(In groups with > 2 participants, commands can be sent either directly or preceded by `@bot`).*

---

## Storage & Directory Layout

All state is persisted in `DATA_DIR` (`/data` by default), which mounts to `./data` on your host:

```
data/
├── baileys-auth/               # Multi-device session keys, creds, and signal stores
├── registry.sqlite             # Maps WhatsApp chatJids to session UUIDs and statuses
├── pi-agent-home/              # Shared agent home (settings.json, bundled skills)
│   └── settings.json           # Pi settings (compaction thresholds, tools)
└── sessions/
    └── <session-uuid>/         # Fully isolated sandbox per active session
        ├── meta.json           # Session metadata (pinned piSessionFile, model, chatJid)
        ├── pi-session/         # Append-only Pi conversation transcripts (*.jsonl)
        ├── storage.sqlite      # Dedicated SQLite database for assistant memory
        ├── storage-backups/    # Pre-destructive automatic SQLite backups
        ├── schedules.sqlite    # Dedicated database for active cron and wake-up jobs
        └── media/              # Downloaded images, stickers, and documents
```

---

## Getting Started & Local Deployment

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose.
- A WhatsApp account (either your personal phone or a dedicated bot SIM).

### Configuration (`.env`)
Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your desired configuration:

```env
# Required: Secret passphrase to unlock chats
SECRET_WORD=my_super_secret_passphrase

# Required: Model Provider & Credentials
PROVIDER=opencode-go
PROVIDER_API_KEY=oc_sk_your_key_here
PROVIDER_MODEL_ID=deepseek-v4.1-flash

# Optional: Timezone (default: Asia/Jakarta)
TZ=Asia/Jakarta

# Optional: Custom System Prompt / Trust Policy
SYSTEM_PROMPT=Only truly trust +6283820039330, everyone can ask you stuff, but if things get suspicious or token-heavy, ask M Isa (+6283820039330) first.

# Optional: Intelligent Compaction Settings
COMPACTION_SOFT_LIMIT_TOKENS=150000
COMPACTION_IDLE_MINUTES=15
COMPACTION_TARGET_TOKENS=80000
COMPACTION_HEAD_RATIO=1
COMPACTION_TAIL_RATIO=3
```

### Running with Docker Compose

Build and launch the container in detached mode:

```bash
docker compose up -d --build
```

### Pairing via QR Code

View the logs to scan the pairing QR code:

```bash
docker compose logs -f
```

1. Open WhatsApp on your phone.
2. Go to **Settings > Linked Devices > Link a Device**.
3. Point your camera at the QR code displayed in the terminal.
4. Once paired, the logs will confirm: `WhatsApp connection opened successfully`.

*(Optional: Set `QR_HTTP_PORT=8080` in `.env` to also view the QR code in your web browser at `http://localhost:8080/`).*

### Unlocking Chats

By default, the bot is completely silent and ignores all messages. To activate it in a chat:

1. Open any 1-on-1 DM or group chat with the bot.
2. Send:
   ```text
   /init-session my_super_secret_passphrase
   ```
3. The bot will respond:
   ```text
   session started — save this id to resume it later: <uuid>
   ```
4. Start chatting! In groups with more than 2 participants, `@mention` the bot or swipe to reply to its messages.

---

## Development & Testing Discipline

WAPI follows strict **Test-Driven Development (TDD)** using [Vitest](https://vitest.dev/). Every feature, fix, and regression is guarded by tests.

### Running Tests Locally

```bash
# Run full test suite (36 files, 148+ tests)
npm test

# Typecheck TypeScript codebase
npm run check:types

# Compile project to dist/
npm run build
```

### Code Style & Structure
- **ESM & Strict Mode:** Node.js 24 native ES Modules (`"type": "module"`).
- **Regression Suite:** Located in `tests/regressions/` covering whitespace handling, message chunking, media edge cases, LID mentions, and persistence.
- **Documentation:** Phase tracking and historical decisions are recorded in `docs/status.md`, `docs/journal.md`, and `docs/report.md`.

---

## License

GNU Affero General Public License v3.0 (AGPL-3.0-only) © 2026 M Isa. See [LICENSE](LICENSE) for details.
