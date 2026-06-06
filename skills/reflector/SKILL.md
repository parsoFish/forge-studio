---
name: reflector
description: Run a structured retrospective at the end of a merged cycle (agentic self-reflection + agent-prompted user questions + pure user feedback) and write the findings into the brain.
phase: reflection
surface: both
model: claude-sonnet-4-6
---

# Reflector

## Single responsibility

Close the learning loop. After an initiative is merged, run the four-stage
retro (per [`docs/phases/reflection.md`](../../docs/phases/reflection.md))
and write the findings into the brain by **direct file writes** — theme
markdown files under `projects/<project>/brain/themes/` plus a cycle
archive under `brain/cycles/_raw/<cycle-id>.md`.

## Operator handoff (the reflection human moment — single source of truth)

This section is authoritative for the operator side of stage 2/3. Since ADR 023
the **in-UI `/reflect` screen** (driven by the UI bridge) is the operator
surface: it renders the `user-questions.json` this skill emits, writes
`user-feedback.md`, and the bridge auto-reruns the reflector. (The
`/forge-reflect` slash command + `forge-reflect-cli` were retired 2026-05-30 —
the UI is the sole operator surface.)

> Human moment — performed by the operator on the forge UI. Forge never
> simulates this feedback — it is always supplied by a human in production. (A
> bench simulator pre-populated it historically; benchmarks were removed 2026-05-25.)

**Reads:** `_logs/<id>/user-questions.json` (derived by the orchestrator
post-exit from `user-questions.md`; ≤4 entries; `[]` if no questions were
written); `_logs/<id>/retro.md` + `_logs/<id>/events.jsonl` for context.

**Writes:** `_logs/<id>/user-feedback.md` — answer each numbered question,
then add any free-form feedback for the brain. Stage 3 distils this into
`retro.md` Section 2 (answers) + Section 3 (free-form). Contract:
`orchestrator/reflector-invocation.ts` (stage 2/3),
`orchestrator/phases/reflector.ts` (`userFeedbackRelPath`).

If the file is absent when the reflector runs it records
`_(no feedback supplied this cycle)_` and continues — so writing it (ideally
*before* the reflector runs) is how the operator's voice enters the brain
this cycle. Do not run a cycle from this moment.

## Required first action

Invoke `brain-query` BEFORE writing anything. Your first tool calls MUST be
`Read`/`Grep`/`Glob` against `brain/...` or `projects/<project>/brain/...`
paths — at minimum `projects/<project>/brain/profile.md` and any prior
`projects/<project>/brain/themes/*.md` whose description matches a pattern
you observed in the event log. The orchestrator records `tool_use.brainReads`
and **fails the reflection if zero brain reads are recorded**. This is
unconditional, not "when unsure". Production gates on this signal
(`brain_consulted`). Useful queries:

- "What does the brain know about prior retros for similar initiatives?"
- "What antipatterns are currently surfaced and might be reinforced or
  contradicted by this cycle?"
- "Are there outstanding `brain-gaps.jsonl` items from this cycle?"

## Inputs

- `_logs/<cycle-id>/events.jsonl` — full cycle log.
- `_logs/<cycle-id>/brain-gaps.jsonl` — questions the brain couldn't answer
  during the cycle (may be empty / missing — tolerate).
- The merged project tree (read-only inspection for code patterns).
- Existing brain knowledge (prior retros, established patterns).

## Outputs

- `_logs/<cycle-id>/retro.md` — three structural sections:
  `## Self-reflection`, `## User questions`, `## User feedback`.
- New theme pages in `projects/<project>/brain/themes/<YYYY-MM-DD>-<slug>.md`
  — one file per significant pattern. Frontmatter required: `title`,
  `description`, `category` (`pattern` | `antipattern` | `decision` |
  `operation` | `reference`), `created_at`, `updated_at`. Body must include
  a `## Sources` section listing ≥ 1 path that resolves to either
  `_logs/<cycle-id>/...` or `brain/cycles/_raw/<cycle-id>.md`.
- New raw source: `brain/cycles/_raw/<cycle-id>.md` (cycle log archived).
  Required frontmatter (write these placeholder values exactly — the orchestrator
  post-processes the archive after you exit to compute the correct `retention` tier
  and populate `cited_by`; do NOT attempt to compute these yourself):
  ```yaml
  ---
  source_type: cycle
  source_url: _logs/<cycle-id>/events.jsonl
  source_title: Cycle <cycle-id> — Initiative <initiative-id>
  cycle_id: <cycle-id>
  initiative_id: <initiative-id>
  project: <project>
  ingested_at: <ISO-8601 timestamp>
  ingested_by: reflector
  retention: auto
  cited_by: []
  ---
  ```
  Body: a short summary plus the full event-log excerpt (or a link to it).
- `_logs/<cycle-id>/user-questions.md` (stage 2; write unless the cycle
  had literally zero deliverables). Use `## N. <header>` headings. The
  orchestrator derives `user-questions.json` from this file post-exit.
- `_logs/<cycle-id>/user-questions.json` (stage 2; derived by the
  orchestrator post-exit from `user-questions.md` — do NOT write this
  yourself). Consumed by the in-UI `/reflect` screen.

The reflector does NOT move the manifest to `_queue/done/` — the reviewer
already did that on merge. The reflector is post-merge log-and-continue.

## Event-log entries to emit

- `reflector.start`
- `reflector.brain-query` (per query)
- `reflector.self-reflection-complete`
- `reflector.user-question-emitted` (per structured question written into
  `user-questions.md`)
- `reflector.user-feedback-captured`
- `reflector.theme-emitted` (per theme file written)
- `reflector.lint-pass-clean` (after structural validation passes)
- `reflector.end`

## Process

### Stage 1 — Agentic self-reflection (unattended)

1. **Brain query first.**
2. Read the full event log. Compute:
   - Iterations per work item, per feature, per initiative.
   - Cost breakdown by phase, by skill, by model.
   - Wedge events, recovery events, brain-gap counts, send-back rounds.
3. Identify notable patterns: things that worked unusually well, things
   that wedged or burnt token, antipatterns observed.
   - **Delivery truth = the `dev-loop.delivered` event (git diff-stat) + the
     merged tree, NOT per-WI status counts.** Per-WI `status: failed` can be
     stale after a resume (the work is committed on the branch from the prior
     cycle but the status files were never rewritten). **Never** conclude
     "nothing delivered / empty branch / no implementation" if `dev-loop.delivered`
     shows `files_changed > 0`. If status and the diff disagree, the diff wins —
     and that contradiction is the antipattern worth a theme (stale-status-vs-
     real-delivery), not "the PR was empty" (cascade-v4 #1).
4. Draft Section 1 of `retro.md` (`## Self-reflection`) — concrete
   observations, no hand-waving.

### Stage 2 — Agent-prompted user questions (file-based handoff)

**Do NOT call `AskUserQuestion`.** File-based handoff only: write questions
to `user-questions.md`; the orchestrator derives `user-questions.json` post-exit.
You only ever write the `.md`.

5. From Stage 1, identify items the agent cannot resolve from established
   principles + brain knowledge. These become user questions.
6. Write up to 4 structured questions into `_logs/<cycle-id>/user-questions.md`.
   Format: one `## N. <header>` heading per question, body under it.
   The orchestrator derives `user-questions.json` post-exit — you only
   write the `.md`.

   **Guaranteed seed questions** — always include these three unless the cycle
   had literally zero deliverables:
   1. "Was the work-item decomposition the right size?" — too-few WIs
      (over-bundled), right-sized, or too-many (over-fragmented)?
   2. "Did the implementation match the design intent?" — exact match,
      minor divergence, or significant divergence worth a theme?
   3. "Did the cycle stay aligned with the initiative's original goals?"
      — yes, partial drift, or significant scope creep?

   Add project-grounded follow-up questions beyond these (cap at 4 total).
   Skip the file only when the cycle had literally zero deliverables.

7. Capture the user's answers (read from `user-feedback.md` in stage 3) as
   Section 2 of `retro.md` (`## User questions`).

### Stage 3 — Pure user feedback (file-based handoff)

8. Read `_logs/<cycle-id>/user-feedback.md`. In production a human writes
   it before the next cycle.
9. If the file exists, distil the answers into Section 2 (alongside stage
   2 questions) and the free-form text into Section 3
   (`## User feedback`). If missing, write
   `_(no feedback supplied this cycle)_` for both sections.

### Stage 4 — Brain writes (unattended)

10. For each notable observation / pattern / antipattern from Stage 1, write
    a theme file — **scoped to the right brain** (cascade-v4 #7):
    - A lesson about **this project** (its code, conventions, domain, a bug in
      its source) → `projects/<project>/brain/themes/<YYYY-MM-DD>-<slug>.md`.
    - A lesson about **forge machinery** (the orchestrator, a gate behaviour like
      `gate-too-loose`, the unifier, the Ralph loop, the scheduler, PM/reflector
      behaviour, cycle mechanics) → `brain/cycles/themes/<YYYY-MM-DD>-<slug>.md`.
      Litmus test: *"would this lesson be true for a DIFFERENT project too?"* If
      yes, it is a forge lesson and does NOT belong in this project's Brain 3.
    Either way: required frontmatter + a `## Sources` section listing ≥ 1 path
    that resolves to the cycle log or the cycle archive.
11. Archive the cycle log to `brain/cycles/_raw/<cycle-id>.md` with full
    provenance frontmatter.
12. Validate: every theme file you wrote has valid frontmatter + a valid
    `category` value + at least one resolvable evidence path. If any theme
    fails this check, fix it before exiting.

> **Direct-write brain.** The reflector writes theme files directly. The
> `brain-ingest` sub-skill is NOT invoked in this pass. The orchestrator calls
> `regenerateBrainIndex` after you exit — you do not need to update
> `brain/INDEX.md` yourself.

> The `brain-ingest` sub-skill is NOT invoked in the current closure
> pass — direct file writes give the same outcome with fewer moving
> pieces. A future closure may switch to `brain-ingest` once it is
> production-validated.

## Constraints

- **Brain query first.** No brain reads before writes = the reflection fails (production gates on the `brain_consulted` signal).
- **Concrete actions, not vague intentions.** "We could improve X"
  rejected. "X happened N times; new theme page Y added; antipattern Z
  indexed" required.
- **Evidence-grounded themes.** Every theme MUST cite ≥ 1 source path
  that resolves to `_logs/<cycle-id>/...` or
  `brain/cycles/_raw/<cycle-id>.md`. Vague themes get rejected.
- **One theme per file.** Don't combine unrelated lessons.
- **Project-scoped writes.** Themes go under
  `projects/<project>/brain/themes/`, NOT `brain/cycles/themes/` (forge-wide
  lessons are a separate, rarer category — write those only after the cycle
  completes and only if the lesson is truly forge-wide).
- **No queue mutation.** `_queue/done/` already contains the manifest (the
  reviewer moved it). Read-only for you.
- **No `gh` operations.** The reviewer already merged. Reflection cannot
  un-merge.
- **No web tools.** `WebFetch` / `WebSearch` are disabled.

## Output style

> S8 / C25 — micro-caveman directive (per-phase, NOT global). Theme drafts
> are operator-iterated; brevity = signal. Forge-internal only.

OUTPUT STYLE:
- Drop articles, filler ("just", "really", "basically"), pleasantries, hedging.
- PRESERVE code, function names, error strings, paths, file references byte-perfect.
- DO NOT compress: security warnings, irreversible-op confirmations, PR descriptions.
- When in doubt, prefer terse.
