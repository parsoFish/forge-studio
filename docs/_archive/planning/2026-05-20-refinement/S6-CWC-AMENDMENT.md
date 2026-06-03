---
stage: S6 (cwc amendment)
date: 2026-05-24
source: anthropics/cwc-workshops/how-we-claude-code (Phase 1)
contract_deps: [C9]
amends: [skills/reflector/SKILL.md, .claude/commands/forge-reflect.md, orchestrator/forge-reflect-cli.ts]
---

# S6 — cwc Amendment: AskUserQuestion-driven reflection handoff

> **Symmetry refinement.** S2A landed the architect's interview step via
> `AskUserQuestion` (cwc Phase 1). The reflector's stage-2 / stage-3
> handoff was still on the file-based pattern (`user-questions.md` →
> operator edits in editor → `user-feedback.md`). This amendment moves
> the reflector's slash command to the same `AskUserQuestion`-driven
> shape — both human moments now share one UX pattern.

## What landed this session

### 1. Reflector SKILL emits BOTH artefacts

[`skills/reflector/SKILL.md`](../../../skills/reflector/SKILL.md) step 6:

- **Keep** writing `_logs/<id>/user-questions.md` — human-readable audit
  trail, pre-amendment shape preserved.
- **Add** writing `_logs/<id>/user-questions.json` — `AskUserQuestion`-shaped
  array (`{question, header, options[]}`). Each entry follows the native
  tool's schema (header ≤12 chars, 2-4 options, each carrying label +
  description).
- The reflector picks 2-4 options per question (most likely answers). The
  slash command always exposes an Other-fallback, so the reflector does
  NOT need to enumerate every possible answer.

Skip rule unchanged: if no questions are warranted, omit BOTH files.

### 2. New `readStructuredQuestions` helper

[`orchestrator/forge-reflect-cli.ts`](../../../orchestrator/forge-reflect-cli.ts)
gains a new export:

```ts
readStructuredQuestions(cycleId, logsRoot?): {
  source: 'json' | 'markdown' | 'none';
  questions: StructuredQuestion[];
}
```

Resolution order:
1. **JSON first** — read `user-questions.json` and validate every entry
   (`question`, `header`, 2-4 options each with label+description). Bad
   shape ⇒ fall through.
2. **Markdown fallback** — parse `user-questions.md` and synthesise a
   generic 3-option set per question (`Nothing notable` / `Worth a theme` /
   `Significant issue`). Header is heuristically derived (first 1-3
   substantive non-stopword tokens, capped at 12 chars).
3. **None** — when neither file exists, return empty.

The fallback ensures pre-amendment cycles still work in post-amendment
sessions.

### 3. Slash command uses `AskUserQuestion` per question

[`.claude/commands/forge-reflect.md`](../../../.claude/commands/forge-reflect.md)
rewritten:

- Step 1-2 unchanged: render in-session context + read the structured
  questions via `readStructuredQuestions`.
- **Step 3 (new)**: for each entry, invoke `AskUserQuestion` with
  `{question, header, options, multiSelect: false}`. Chip-style selection;
  Other-fallback always available.
- **Step 4 (new)**: one trailing free-form `AskUserQuestion`
  (`"Anything else worth capturing this cycle?"`) with the same 3-option
  set the markdown-fallback synthesises.
- Step 5-6 unchanged: `writeOutput()` writes `user-feedback.md` + auto-rerun.

The operator's UX matches `/forge-architect`'s interview step — chip-style
choices, Other-fallback for prose, no editor round-trip needed for the
common case.

### 4. Tests

`benchmarks/architect/` + every other bench harness untouched. New
deterministic tests in
[`orchestrator/forge-reflect-cli.test.ts`](../../../orchestrator/forge-reflect-cli.test.ts):

- `readStructuredQuestions: prefers user-questions.json when present`
- `readStructuredQuestions: falls back to markdown when JSON absent`
- `readStructuredQuestions: returns source:none when neither file exists`
- `readStructuredQuestions: malformed JSON falls through to markdown`
- `readStructuredQuestions: JSON with bad shape (options too few/many) rejects, falls through`
- `readStructuredQuestions: JSON with empty header field rejects`

Total test count: 754 (+6). All pass; `tsc --noEmit` clean.

## What this amendment does NOT change

- **`writeOutput()` shape** — same file format, same C9 auto-rerun.
  The chip-label answer text replaces the operator's editor-typed answer
  text; both pass through the same `answers: string[]` array.
- **`parseFeedback()`** — unchanged. `user-feedback.md` is still the
  canonical record consumed by the reflector's stage 3.
- **Bench harness** ([`benchmarks/reflection/`](../../../benchmarks/reflection/))
  — non-interactive; the bench simulator pre-populates `user-feedback.md`
  directly, never invoking the slash command. No bench changes needed.
- **C9 (auto-rerun default)** — unchanged.
- **Reflector phase code** ([`orchestrator/phases/reflector.ts`](../../../orchestrator/phases/reflector.ts))
  — unchanged. The reflector ALREADY ran a Write-tool call for
  `user-questions.md`; the SKILL change just asks it to also Write
  `user-questions.json`. No new orchestrator wiring.

## Asymmetry resolved

| Human moment | Pre-amendment | Post-amendment |
|---|---|---|
| `/forge-architect` (S2A) | `AskUserQuestion` interview ✅ | `AskUserQuestion` interview ✅ |
| `/forge-reflect` (S6B) | file-based (`user-questions.md` → operator edits → `user-feedback.md`) | `AskUserQuestion` per structured question ✅ |
| `/forge-review` (S4) | PR-comment loop (unchanged — PR is the right surface here) | PR-comment loop (unchanged) |

All three forge human moments now use the **right UX primitive** for
their context. The reviewer keeps PR comments because the surface
inherently is the PR; the architect + reflector use `AskUserQuestion`
because they're conversational moments.

## Pending (operator wake-up)

- **Real cycle exercise** — drive a betterado cycle to close; observe
  the reflector emit `user-questions.json`; run `/forge-reflect <id>`;
  watch the `AskUserQuestion` chips render. This is the same
  API-blocked verification path as every other refinement stage.
- **Frontend-slides skill comparison** — the architect's `PLAN.html`
  uses inline-CSS, no JS, no frontend-slides framework. A future
  refinement could lift `STYLE_PRESETS.md` patterns into PLAN.html for
  richer typography. Out of S6 scope; flagged in
  [S2A-CWC-AMENDMENTS.md](./S2A-CWC-AMENDMENTS.md) under "skills note".
