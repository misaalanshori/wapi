# Conversational Context, Replies & Group Situational Awareness — Design & Implementation Plan

**Authoritative Context:** WhatsApp Personal Assistant (`wapi`) & Baileys / Pi SDK Integration  
**Status:** Proposed Architecture & Phased Plan  
**Target File:** `docs/conversational-context-and-replies-plan.md`  

---

## 1. Problem Statement & Motivation

While the assistant now knows who sends an addressed message and which group it is in, it suffers from three critical conversational blindspots:

1. **Blind to Quoted / Replied-To Messages:**
   - When a user quotes a message in WhatsApp and asks *"@bot can you repeat this"*, *"what does this mean?"*, or *"translate this"*, the assistant only receives the current turn's text (`"@bot can you repeat this"`). The quoted content (`contextInfo.quotedMessage`) is completely dropped, making reply-based workflows impossible.

2. **Replies to Bot Messages Dropped in Groups:**
   - When the assistant sends a message or reminder in a group and a user replies directly to it via WhatsApp's swipe-to-reply gesture, the addressing gate drops it if the user didn't also type `@bot`. In natural human conversation, swiping to reply to the bot IS addressing the bot.

3. **No Situational Context (Recent Chatter Blindness):**
   - Because the assistant drops all unaddressed group chatter at the network boundary, it has zero knowledge of preceding conversation when called. If someone asks *"@bot what were they just arguing about?"* or *"summarize the decision above"*, the model has zero context.

4. **Incomplete Group Roster & Topic Knowledge:**
   - The assistant knows the group title and member count, but does not know the group description/topic or who the participants and admins are.

---

## 2. Technical Architecture & Baileys Data Sources

### 2.1 Quoted Message Extraction (`contextInfo`)
WhatsApp represents replies inside `extendedTextMessage.contextInfo`:

```typescript
contextInfo: {
  stanzaId: "3EB0...",             // Quoted message ID
  participant: "62812345678@s.whatsapp.net", // Author of quoted message
  quotedMessage: {                  // Full protobuf message structure
    conversation?: string,
    extendedTextMessage?: { text: string },
    imageMessage?: { caption?: string, ... },
    // ...
  }
}
```

### 2.2 Direct Reply Detection
When `msg.key.remoteJid` is a group and `contextInfo.participant` matches any of the bot's known identifiers (`botJid` or `botLid`), the message is a direct reply to the bot and is treated as **addressed** without requiring a text `@mention`.

### 2.3 Rolling Ambient Message Buffer (`ChatHistoryBuffer`)
To give the LLM recent context without wasting tokens or running LLM inference on every group message:
- Maintain an in-memory ring buffer (default: last 15 messages) per active chat.
- In active sessions, store unaddressed text/image messages in the buffer:
  `{ senderName, senderPhone, text, timestamp }`.
- When an addressed turn triggers, inject the recent messages since the last assistant response as ambient context before the user's prompt.
- Memory bound: ring buffer of fixed capacity (15 items), zero disk persistence needed (ephemeral context).

### 2.4 Rich Group Roster & Description
`sock.groupMetadata(chatJid)` yields:
- `subject`: Group title.
- `desc`: Group description / pinned rules.
- `participants`: Array of `{ id, admin: "admin" | "superadmin" | null }`.

---

## 3. Formatting & Prompt Envelope Specification

### 3.1 Quoted Message Header
When an incoming message quotes an earlier message, format the quoted reference immediately before the user's turn:

```text
[Replying to ${quotedSenderName} (${quotedPhone}): "${quotedSnippet}"]
[From: ${senderName} (${senderPhone}) in "${groupSubject}"]: ${messageText}
```

*Example:*
```text
[Replying to Alice (+628111111): "Deploying v2.1 to production tonight at 8 PM"]
[From: M Isa (+6283820039330) in "Dev Ops"]: @bot what time is that in Jakarta?
```

If the quoted message was an image with caption:
```text
[Replying to Bob (+628222222): [Image: "Architecture diagram for auth"]]
[From: M Isa (+6283820039330) in "Dev Ops"]: @bot explain the diagram flow
```

---

### 3.2 Recent Group Ambient Context
When preceding unaddressed chatter exists in the group since the last assistant turn, format it as an ambient context block:

```text
[Recent group context]:
- Alice (+628111111): Has anyone checked the Redis memory leak?
- Bob (+628222222): Yes, PR #42 fixes it by expiring keys after 24h.
- Charlie (+628333333): Merged to staging.

[From: M Isa (+6283820039330) in "Engineering"]: @bot did they fix the Redis leak?
```

*Buffer Bounds & Rules:*
- Max 10 messages included in the ambient block.
- Snippet max 200 characters per ambient message (truncated with `...` if longer) to preserve prompt token budget.
- Clear or advance ambient buffer after an agent turn so the same chatter is not repeated.

---

### 3.3 Enhanced System Prompt Preamble
Incorporate group description and member roster into the session system prompt:

```text
You are a personal assistant operating inside WhatsApp group "${groupSubject}" (JID: ${chatJid}, ${participantCount} participants).
Group topic: "${groupDescription || "No description set"}".
Admins: ${adminList || "None listed"}.
Current timezone is ${timeZone}.
Multiple participants can speak in this chat; each incoming user message indicates the sender.
When replying, address the relevant participant when helpful, and keep answers concise and suitable for a group conversation.
```

---

## 4. Addressing Gate Rule Extension

Update `isMessageAddressed` in `src/addressing-gate.ts`:

```typescript
export interface AddressingGateInput {
  chatJid: string;
  isGroup: boolean;
  participantCount: number;
  mentionedJids: string[];
  quotedParticipant?: string | null; // JID of the sender of the quoted message
  botJid?: string | null;
  botLid?: string | null;
  botJids?: string[];
  text?: string;
}
```

**New Rule:**
If `input.quotedParticipant` matches any bot identifier in `botJids`, return `true` (addressed via swipe-to-reply).

---

## 5. Phased Implementation Plan

### Phase R1: Quoted Message Extraction & Reply Addressing
- **Goal:** Extract quoted messages and treat replies to the bot as addressed.
- **Failing Tests:**
  - `tests/message-extractor.test.ts`: extract `quotedMessage` text, participant, phone, and pushName.
  - `tests/addressing-gate.test.ts`: swipe-to-reply to bot returns `true` even with 0 text mentions.
- **Implementation:**
  - Update `src/message-extractor.ts` to populate `quoted` info in `ExtractedMessage`.
  - Update `src/addressing-gate.ts` to accept `quotedParticipant`.
  - Update `src/index.ts` to pass `quotedParticipant`.

### Phase R2: Quoted Message Turn Formatting
- **Goal:** Format `[Replying to <User>: "<Text>"]` header in user turns.
- **Failing Tests:**
  - `tests/message-extractor.test.ts`: test `formatUserPromptWithAttribution` with `quoted` parameter.
- **Implementation:**
  - Update `formatUserPromptWithAttribution` to prepend quoted context.

### Phase R3: Ambient Chatter Buffer
- **Goal:** Maintain rolling in-memory buffer of recent group messages and inject recent chatter into addressed turns.
- **Failing Tests:**
  - `tests/chat-history-buffer.test.ts`: ring buffer bounded at N items, FIFO eviction, clearance per turn.
- **Implementation:**
  - Create `src/chat-history-buffer.ts`.
  - In `src/index.ts`, push active session messages to buffer; flush/format into prompt on addressed turns.

### Phase R4: Group Roster & Description in Session Preamble
- **Goal:** Enrich `buildDefaultPreamble` with group description and admin list.
- **Failing Tests:**
  - `tests/agent-manager.test.ts` & regressions.
- **Implementation:**
  - Update `CachedGroupMetadata` to include `description` and `admins`.
  - Update `buildDefaultPreamble` in `src/agent-session-manager.ts`.

### Phase R5: Verification & Deployment
- Full test run (`vitest run`).
- Typecheck (`tsc --noEmit`).
- Multi-stage Docker build & deployment.
- Update `docs/status.md` and `docs/journal.md`.

---

## 6. Acceptance Criteria

1. In a group with >2 participants, replying (swiping) to a message sent by the bot triggers the bot without needing an `@mention`.
2. Quoting any message in a group or DM and asking *"summarize this"* or *"what does this mean?"* gives the model the exact quoted message content.
3. Asking *"@bot what were they discussing above?"* in a group gives the model the recent ambient conversation context.
4. Asking *"what is this group about?"* or *"who runs this group?"* gives the model the group topic and admin list.
5. All tests green and prompt caching remains efficient.
