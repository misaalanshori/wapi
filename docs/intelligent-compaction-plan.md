# Intelligent Prompt Compaction (Soft Limit, Idle Timer & Head:Tail Sandwich) — Design & Implementation Plan

**Authoritative Context:** WhatsApp Personal Assistant (`wapi`) & Pi SDK  
**Status:** Proposed Architecture & Phased Plan  
**Target File:** `docs/intelligent-compaction-plan.md`  

---

## 1. Problem Statement & Motivation

For models with massive context windows (such as `deepseek-v4.1-flash` with a 1,000,000-token limit), Pi's default automatic compaction formula (`contextTokens > contextWindow - reserveTokens`) does not trigger until context reaches ~950,000 tokens.

In an all-day WhatsApp assistant:
1. **The 5-Minute Cache Invalidation Problem:** LLM providers drop prefix KV cache after ~5–10 minutes of idle time. Intermittent messages (morning, afternoon, evening) force the model to re-read the entire accumulated backlog from scratch at full non-cached cost and high latency.
2. **The Interruption Problem:** Naive compaction triggering *mid-turn* freezes active conversation for 20–30 seconds while summarization executes.
3. **The Recency & Origin Loss Problem:** Naive tail compaction summarizes from turn 1 up to the cut point, which often forgets the foundational goals and constraints established at session creation ("Head Amnesia").

---

## 2. Three-Tier Compaction Architecture

| Tier | Name | Threshold | Action |
|---|---|---|---|
| **Tier 1** | **Unrestricted Verbatim** | `< 150,000 tokens` | Zero compaction ever runs. Verbatim history is preserved across cache invalidations. |
| **Tier 2** | **Soft Limit & Idle Timer** | `>= 150,000 tokens` + `15 mins idle` | Starts a 15-minute countdown. Resets on every new message. Runs background compaction only after 15 minutes of continuous silence. |
| **Tier 3** | **Hard Safety Net** | `~950,000 tokens` | Pi's built-in standard threshold/overflow compaction to prevent hard API context limits. |

---

## 3. The 1:3 Head-to-Tail Preservation Sandwich

When the Tier 2 idle timer triggers, context is compacted down toward the **Compaction Target (`80,000 tokens`)**:

```text
[Verbatim Session Head (~20k tokens)] 
                 + 
[Summarized Intermediate Middle (~5k token summary node)]
                 + 
[Verbatim Recent Tail (~60k tokens)]
```

### 3.1 Mathematical Ratios
- **Head Ratio:** 1 part (default: 25% of target budget ≈ 20,000 tokens).
- **Tail Ratio:** 3 parts (default: 75% of target budget ≈ 60,000 tokens).
- **Compaction Target:** 80,000 tokens.
- **Conservative Bias:** Exceeding the target is completely acceptable; the system prioritizes preserving context over aggressive truncation.

### 3.2 Pi Context Model Mapping
In Pi's `CompactionEntry` architecture:
1. `firstKeptEntryId` is placed at the start of the **Tail** (~60,000 tokens before the end).
2. The **Head** (earliest conversation turns) is preserved verbatim in the custom summarization payload and embedded in the summary node header:
   ```markdown
   # Session Foundation & Initial Goals (Head)
   <Verbatim extract of initial user instructions, preferences, and project definitions>

   # Intermediate Discussion Summary (Middle)
   <Structured summary of intermediate work, tool executions, and decisions>
   ```
3. The active session projection loads:
   `[System Prompt] -> [Compaction Entry with Head Context & Middle Summary] -> [Verbatim Tail Turns]`.

---

## 4. Configuration Schema (`.env.example`)

```env
# Soft limit token count before the idle countdown begins (default: 150000)
COMPACTION_SOFT_LIMIT_TOKENS=150000

# Idle silence window in minutes before background compaction executes (default: 15)
COMPACTION_IDLE_MINUTES=15

# Target token count to compact down toward (default: 80000)
COMPACTION_TARGET_TOKENS=80000

# Head-to-Tail preservation ratio (default: 1:3)
COMPACTION_HEAD_RATIO=1
COMPACTION_TAIL_RATIO=3
```

---

## 5. Phased Implementation Plan

### Phase K1: Config & Types
- Update `src/config.ts` to parse and validate compaction configuration with safe defaults.
- Unit tests in `tests/config.test.ts`.

### Phase K2: Compaction Coordinator & Idle Timer Logic
- Create `src/compaction-coordinator.ts`:
  - `recordTurn(sessionId, tokens, runCompactionFn)`: Tracks token count and manages 15-minute debounced timer.
  - `cancelTimer(sessionId)`: Resets timer on incoming messages.
  - Unit tests in `tests/compaction-coordinator.test.ts`.

### Phase K3: Sandwich Compaction Execution
- Implement `executeSandwichCompaction`:
  - Computes cut points using `keepRecentTokens: tailBudget`.
  - Formulates custom compaction instructions preserving initial head turns.
  - Chains onto `sessionQueues` in `AgentSessionManager` to prevent race conditions with user messages.
  - Unit tests in `tests/compaction-coordinator.test.ts`.

### Phase K4: AgentSessionManager Integration
- Wire coordinator into `AgentSessionManager`:
  - After turn completion, inspect usage and report tokens to coordinator.
  - Inbound messages call `coordinator.cancelTimer(sessionId)`.
  - Unit tests in `tests/agent-manager.test.ts`.

### Phase K5: Regression Suite & Verification
- Permanent regression test `tests/regressions/intelligent-compaction.regression.test.ts`.
- All gates green (`check:types`, `vitest run`, `build`, Docker build).
- Update `docs/status.md` and `docs/journal.md`.
