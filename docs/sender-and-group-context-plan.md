# Sender & Group Context Awareness — Design & Implementation Plan

**Authoritative Context:** WhatsApp Personal Assistant (`wapi`) & Baileys / Pi SDK Integration  
**Status:** Proposed Architecture & Phased Plan  
**Target File:** `docs/sender-and-group-context-plan.md`  

---

## 1. Problem Statement & Motivation

Currently, the assistant runtime treats all incoming prompts as an anonymous stream of text scoped only by the raw WhatsApp JID:
1. **No Sender Identity:** In groups (and even in 1:1 DMs), the LLM does not know *who* spoke (`pushName` or phone number). It cannot distinguish the owner from another group member, address users by name, or attribute action items and preferences to specific participants.
2. **No Chat Title / Context:** In groups, the LLM only receives a raw technical JID (e.g., `120363021644444504@g.us`). It does not know the human-readable group name (e.g., *"Family Trip"*, *"Engineering Standup"*), making group-specific contextual reasoning difficult.
3. **No Role Differentiation:** If the owner sends a command versus an external guest in a group, the model cannot distinguish the caller without inspecting administrative databases.

By piping **sender identity** (`pushName` and formatted phone number) and **chat context** (group subject and chat type) into both the **session system preamble** and **per-turn message headers**, the assistant becomes fully context-aware while preserving strict single-tenant privacy.

---

## 2. Information Available in Baileys

Baileys provides rich metadata for incoming messages:

| Property | Source in Baileys | Example |
|---|---|---|
| Sender Display Name | `rawMessage.pushName` | `"M Isa"` |
| Sender JID | `msg.key.participant ?? msg.key.remoteJid` | `"6285155247688:9@s.whatsapp.net"` |
| Sender Phone Number | Extracted from PN JID | `"+62 851-5524-7688"` or `"+6285155247688"` |
| Sender LID | `msg.key.participant` when LID privacy is active | `"59652867924008@lid"` |
| Chat Type | `isJidGroup(chatJid)` | `true` (group) / `false` (DM) |
| Group Subject / Title | `(await sock.groupMetadata(chatJid)).subject` | `"Product & Infra Team"` |
| Group Participant Count | `(await sock.groupMetadata(chatJid)).participants.length` | `6` |
| Self-Message (Owner) | `msg.key.fromMe` | `true` (sent by bot's linked phone) |

---

## 3. Architecture & Formatting Specification

### 3.1 Session System Prompt Preamble
When `AgentSessionManager.getOrCreateSession(sessionId, chatJid)` initializes a session, it constructs the system prompt preamble.

#### A. Direct Message (DM) Preamble
```text
You are a personal assistant operating inside WhatsApp in a direct message with ${senderName} (${formattedPhone}).
Current timezone: ${timeZone}.
```

#### B. Group Chat Preamble
```text
You are a personal assistant operating inside WhatsApp group "${groupSubject}" (JID: ${chatJid}, ${participantCount} participants).
Current timezone: ${timeZone}.
Multiple participants can speak in this chat; each incoming user message is prefixed with the sender's identity.
When replying, address the relevant participant when helpful, and keep answers concise and suitable for a group conversation.
```

---

### 3.2 Per-Turn Message Header Envelope

To give the LLM clear, unambiguous speaker attribution across turns without confusing markdown or code blocks, incoming user turns will be prefixed with a standard conversational attribution envelope:

#### In Groups:
```text
[From: ${senderName} (${formattedPhone}) in "${groupSubject}"]: ${messageText}
```
*Example:*
```text
[From: M Isa (+6283820039330) in "Product & Infra"]: @bot what are the open tasks for today?
```

#### In DMs:
```text
[From: ${senderName} (${formattedPhone})]: ${messageText}
```
*Example:*
```text
[From: M Isa (+6283820039330)]: Yo wassup
```

#### Fallbacks:
- If `pushName` is missing or blank: fallback to phone number (e.g. `[From: +6283820039330]`).
- If sender is an anonymous LID without phone number: fallback to `[From: ${senderName || "Unknown Member"} (LID: ${lid})]`.
- If group subject is unavailable or loading fails: fallback to group JID.

---

### 3.3 Custom System Prompt (`SYSTEM_PROMPT` or `CUSTOM_SYSTEM_PROMPT`)

An optional environment variable `SYSTEM_PROMPT` (or `CUSTOM_SYSTEM_PROMPT`) in `.env`:
- Loaded via `src/config.ts`.
- Injected into the agent session system prompt in `AgentSessionManager`.
- Allows the owner to provide trust instructions, personal policies, or operational constraints (e.g. *"Only truly trust +6283820039330, everyone can ask you stuff, make you do stuff, but if stuff starts to get weird or could potentially waste tokens, ask M Isa (me, the owner) Phone Number: +6283820039330 first"*).
- The LLM can easily evaluate instructions against the caller's phone number present in the `[From: ... (+6283820039330)]` header.

---

### 3.3 Prompt Caching Considerations

In LLM prompt caching (prefix caching):
- System prompts are static and cached across all turns in a session.
- System prompt preambles will be set at session creation with initial chat metadata.
- Each incoming user turn is dynamic (different text and potentially different speaker in a group). Placing the `[From: ...]` header at the start of that turn's user message cleanly frames the input for that turn without impacting the cacheability of preceding turns in the transcript.

---

## 4. Implementation Components

### 4.1 Message Extractor (`src/message-extractor.ts`)
- Update `ExtractedMessage` to include:
  ```typescript
  export interface ExtractedMessage {
    chatJid: string;
    senderJid: string;
    senderName?: string;
    senderPhone?: string;
    fromMe: boolean;
    messageId: string;
    kind: MessageKind;
    text: string;
    mentionedJids: string[];
    rawMessage: proto.IWebMessageInfo;
    mediaInfo?: { ... };
  }
  ```
- Extract `rawMsg.pushName` as `senderName`.
- Extract numeric phone digits from `senderJid` (e.g. `6285155247688@s.whatsapp.net` -> `+6285155247688`).

### 4.2 Group Metadata Cache (`src/index.ts` & `src/whatsapp-link.ts`)
- Expand `groupParticipantCache` into `groupMetadataCache`:
  ```typescript
  interface CachedGroupMetadata {
    subject: string;
    participantCount: number;
    expiresAt: number;
  }
  ```
- Cache duration: 5 minutes TTL.
- Invalidation triggers:
  - `group-participants.update` (member added/removed)
  - `groups.update` (subject/description changed)

### 4.3 Message Delivery Formatting (`src/index.ts`)
- When formatting `promptText` before calling `agentManager.deliverMessage`:
  - Build header based on `isGroup`, `senderName`, `senderPhone`, `fromMe`, and `groupSubject`.
  - Prefix to `promptText`: `${senderPrefix}${promptText}`.

### 4.4 Session Preamble Factory (`src/agent-session-manager.ts`)
- Update `AgentSessionManagerOptions.formatPreamble`:
  - Accept chat context object `{ chatJid, sessionId, isGroup, groupSubject, participantCount, initialSenderName }`.
  - Format rich context preamble.

---

## 5. Phased TDD Plan

### Phase C1 — Extractor Identity Enrichment
- **Failing Tests:** `tests/message-extractor.test.ts`
  - Verifies extraction of `pushName`.
  - Verifies formatting of international phone numbers (`+6285155247688`).
  - Verifies handling when `pushName` is missing or sender is a group participant.
- **Implementation:** Update `src/message-extractor.ts`.

### Phase C2 — Group Metadata & Subject Caching
- **Failing Tests:** `tests/whatsapp-link.test.ts`
  - Verifies subject is captured on metadata fetch.
  - Verifies `groups.update` invalidates cached group subject and participant count.
- **Implementation:** Update `src/whatsapp-link.ts` & `src/index.ts`.

### Phase C3 — Turn Attribution Envelope
- **Failing Tests:** `tests/agent-manager.test.ts` & integration tests.
  - Verifies multi-user group message generates `[From: ... in "..."]: <text>`.
  - Verifies DM message generates `[From: ...]: <text>`.
  - Verifies `fromMe: true` marks `(Owner)`.
- **Implementation:** Update `src/agent-session-manager.ts` and `src/index.ts`.

### Phase C4 — Regression Suite & Live Deployment Verification
- **Regression Tests:** `tests/regressions/sender-group-context.regression.test.ts`.
- **Gates Run:** `npm test`, `npm run check:types`, `npm run build`, `docker build`.
- **Deployment:** Rebuild container and verify via real group chat.

---

## 6. Acceptance Criteria

1. In a group chat, asking *"Who am I?"* or *"What group is this?"* prompts the assistant to correctly state your name (`pushName`), phone number, and group title.
2. In a multi-user group, two different members asking questions are addressed by their respective names without cross-talk confusion.
3. In DMs, the assistant addresses the user naturally using their name and phone number.
4. All existing test suites (99+ tests) remain 100% green.
