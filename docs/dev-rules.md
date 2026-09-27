# Development cycle (append to your brief)

Work in **development cycles**. Each cycle has a locked goal decomposed
into ordered phases; each phase ends on named evidence, never on "code
written." This is how every phase is worked.

## Autonomy
- Run to completion. No confirmation at phase boundaries, no questions.
  Make the call, record it, keep going.
- The only stopping condition is the acceptance checklist at the end — or
  genuine hard blockage after the stuck protocol, and then with a written
  recommendation.

## The phase loop (mandatory, every phase)
1. **Read** the spec and anything it cites. Restate the definition of done
   to yourself before touching code.
2. **Write the failing test first.** TDD is a requirement, not a
   preference.
3. **Implement the minimum that passes.** Boring over clever. No
   speculative abstractions, no scaffolding "for later." No new
   dependencies without [the approval path].
4. **All gates green before every commit** — never commit red:
   `[format check]` · `[lint at zero warnings]` · `[typecheck]` ·
   `[test suite]` · `[project-specific gates]`.
5. **Commit small and often.** Imperative subject; the body cites the
   requirement / decision / issue it implements. The tree is clean at
   every phase boundary. Push once per phase (batched); a red CI run is
   the exception — fix it, push, verify green, then continue.
6. **Verify in use, not just in tests.** If a user can see it or do it,
   drive it for real and look at it. A fix you can't feel is not done.
   Journal driven work in `[journal file]`, dated.
7. **Update `[status doc]`** — done items get commit ids; undone items get
   honest "not done + why" lines.
8. Next phase.

## Test discipline
- Every defect that reached a user gets a **named permanent regression
  test** in `[tests/regressions/]`, written in the same change as its fix
  (named after its tracking id: issue number or report finding number).
- Tests clean up after themselves.
- Platform- or environment-specific tests **skip with a named reason,
  never fail**, where their harness is absent.

## Driving (dogfooding)
- Any "make it usable" phase spends at least half its time on unscripted
  use — not scripted checks of known features.
- Every annoyance is a bug: fix it (regression test if it's a real
  defect), then **re-drive the same journey to feel the fix**.

## Standing law
- **Specs and recorded decisions are law.** Never silently change a
  decision — annotate and supersede it. A genuinely new design decision
  gets a short written record **before** the code.
- Settled decisions — never re-litigate: `[list]`.
- **No new features mid-cycle.** The goal is the goal; good ideas go in
  the report's recommendations, not into the tree.
- Secrets never appear in logs, commits, test output, or reports.
- Every command is bounded (timeouts on anything hang-prone; a hung test
  is a defect).
- Refactors use the safe discipline: the suite is the bracket, behavior
  does not change, one unit per commit, every diff stays reviewable.
- If documents conflict: `[authoritative source]` wins; if the
  authoritative ones conflict, take the safer reading and record the
  conflict in the report.

## Stuck protocol
1. Retry once, simpler.
2. Check `[reference implementation / docs]`.
3. Ship the smallest working workaround with a test; leave a debt note
   naming the ceiling and the upgrade path.
4. Still stuck: write a risk table (attempt, result, hypothesis, residual
   risk) **with your recommendation** into the report, mark the item
   honestly in the status doc, move to the next phase. Never stop the run.

## Cycle close-out
- Gates green; `[CI]` green; status doc synced.
- Write `[report file]`:
  1. what was done per phase, and what was driven for real;
  2. what now works end to end (journeys, not internals);
  3. kinks left — ranked, each with a repro;
  4. fixed this cycle: defect → fix → commit → regression test;
  5. deferred state + recommendations for the next cycle.

## Acceptance checklist (the only stopping condition)
- [ ] Every phase's exit condition met with named evidence.
- [ ] Every defect found has its regression test; the suite grew.
- [ ] All gates green; CI green.
- [ ] Report written; tree clean; everything pushed.

---

**Placeholders to fill per project:** the gate list (TS example:
`prettier --check`, `eslint --max-warnings=0`, `tsc --noEmit`,
`vitest run`, build), the regression-test location, the status doc and
report filenames, the settled-decisions list, the authoritative source,
the reference implementation.

**The three rules that do the heavy lifting:** never commit red · a fix
you can't feel isn't done · regression tests travel with fixes.
