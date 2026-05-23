---
description: Reflection human moment — interview the operator via AskUserQuestion, write user-feedback.md, auto-rerun reflector.
argument-hint: <initiative-id-or-handle>
---

# /forge-reflect <initiative-id>

> Human interaction moment — run in YOUR OWN Claude session. Forge never
> simulates this feedback in production (the bench simulator is bench-only).

Initiative / cycle: **$ARGUMENTS**

## What this command does (S6B + cwc Amendment)

1. **Read the reflector's stage-2 structured questions** via
   `orchestrator/forge-reflect-cli.ts:readStructuredQuestions()` — prefers
   `_logs/<id>/user-questions.json` (post-cwc-amendment shape), falls back
   to synthesising from `_logs/<id>/user-questions.md` (pre-amendment
   cycles). Returns 0-4 `{question, header, options[]}` entries.
2. **Render the in-session context block** via
   `orchestrator/forge-reflect-cli.ts:render()` — header + retro / events /
   recap links so the operator has provenance.
3. **Invoke `AskUserQuestion` per question** (cwc Amendment) — instead of
   the legacy inline-markdown answer block, pass each structured question
   to the native tool so the operator picks from chip-style options or
   selects "Other" + types prose. Parity with `/forge-architect`'s
   interview step.
4. **Collect a single free-form follow-up** — one additional
   `AskUserQuestion` with options `["Nothing more", "Worth a theme",
   "Significant issue"]` and Other-fallback. Whatever the operator types
   in Other becomes the free-form section body.
5. **Write `_logs/<id>/user-feedback.md`** via
   `orchestrator/forge-reflect-cli.ts:writeOutput()` in the SKILL's
   canonical format (numbered answers + free-form section). The chip
   labels + any Other-text are concatenated into each answer.
6. **Auto-invoke `forge reflect <id> --rerun`** per CONTRACTS.md C9 —
   default-on. The reflector re-runs against the closed manifest with the
   operator's answers as additional context.

`rerun: false` (pass to `writeOutput`) skips step 6 — the file is still
written, but no second reflector pass fires until the operator manually
runs `forge reflect <id> --rerun`.

## Run

Step 1: render the in-session context + read the structured questions.

```bash
node --experimental-strip-types orchestrator/cli.ts reflect $ARGUMENTS
```

Step 2: read the structured questions in this session.

```bash
node --experimental-strip-types -e "
import('./orchestrator/forge-reflect-cli.ts').then((mod) => {
  const r = mod.readStructuredQuestions('$ARGUMENTS');
  console.log(JSON.stringify({ source: r.source, questions: r.questions }, null, 2));
});
"
```

Step 3: for each entry in the returned `questions` array, call
`AskUserQuestion` with `{ question, header, options, multiSelect: false }`.
Capture each answer (the operator picks an `option.label` or types text in
"Other"). When the operator picks an option, the answer string is
`"<label> — <description>"`; when they type Other-text, the answer is
the Other-text verbatim.

Step 4: ask one trailing free-form question via `AskUserQuestion`:

```
question: "Anything else worth capturing this cycle?"
header:   "Free-form"
options:
  - { label: "Nothing more", description: "Skip the free-form section." }
  - { label: "Worth a theme", description: "Note something for the brain." }
  - { label: "Significant issue", description: "Flag for next cycle's planning." }
```

If the operator picks "Nothing more", the free-form body is empty. If they
pick another option or type Other-text, the freeform body is the chosen
label plus their text.

Step 5: write the feedback file from the same session:

```bash
node --experimental-strip-types -e "
import('./orchestrator/forge-reflect-cli.ts').then(async (mod) => {
  const res = await mod.writeOutput({
    cycleId: '$ARGUMENTS',
    answers: [/* one string per question, in order */],
    freeform: '<aggregated free-form text>',
    /* rerun defaults to true per C9; pass rerun: false to override */
  });
  console.log('wrote:', res.feedbackPath, '| rerun:', res.rerun);
});
"
```

After `writeOutput()` resolves, `_logs/$ARGUMENTS/user-feedback.md` is the
canonical record. Stop here — do not run a cycle from this moment.

## When there are no questions

If `readStructuredQuestions` returns `source: 'none'`, the reflector found
no agent-prompted user questions for this cycle. Skip step 3. Go directly
to step 4 (the trailing free-form `AskUserQuestion`) so the operator can
still volunteer feedback. If they pick "Nothing more", `writeOutput`
writes an empty answers array + the placeholder freeform.

## See also

- `skills/reflector/SKILL.md` §"Stage 2 — Agent-prompted user questions"
  — the SKILL contract for emitting both `user-questions.md` and
  `user-questions.json`.
- `docs/planning/2026-05-20-refinement/06-reflect.md` §"Slash-command UX".
- `docs/planning/2026-05-20-refinement/CONTRACTS.md` C9, C15a.
- `docs/planning/2026-05-20-refinement/S2A-CWC-AMENDMENTS.md` — the
  architect interview pattern this command mirrors.
