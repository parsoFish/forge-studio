/**
 * The prose migration itself — a CONTRACT between two files that must agree.
 *
 * ADR 024's thesis is that SKILL.md is the single source of an agent's
 * instructions. These assertions read the real
 * `packages/sessions/kinds/instructions.ts` and the real
 * `skills/instructions-creator/SKILL.md` off disk and compare them, which is
 * what `contract/` means (tests/README.md): parity between two things that
 * must agree. AT-9 — the named prose has LEFT the .ts and now lives in
 * SKILL.md, so intent is not duplicated or forked. AT-10 — the private
 * `loadSkillPrompt`'s fail-open literal ("You are the forge
 * instructions-creator agent.") did not survive the migration, because a
 * silent no-task agent run has no signal. R2-AT-2 — every distinct
 * pre-refactor instruction sentence, frozen from base commit c45e3892 across
 * SKILL.md AND both prompt-building arrays, is still reachable in today's
 * SKILL.md, so nothing was quietly dropped.
 *
 * ROUND 2 (R2-AT-*). An adversarial review of the landed WI-1 commit
 * (90cbc634) found real defects in the composed prompt and in the loader
 * itself. Those ATs were written BEFORE any fix landed, on the same rule as
 * AT-1..AT-10: an implementer may make them PASS by fixing the defect each
 * comment describes; it may NOT edit them to make them pass.
 *
 * SPLIT FROM a 1,027-line file along the three concerns its own banners
 * declare — LOADER, INSTRUCTIONS RUNNER, GREP-ASSERT — with each round-2 AT
 * filed under the concern it actually tests rather than under its number. The
 * three parts are `unit/skill-turn-sections` (the pure loader),
 * `integration/instructions-turn-prompt` (the composed prompt a real turn
 * produces) and `contract/skill-md-prose-migration` (the prose actually left
 * the .ts and reached SKILL.md). The split retires the file's
 * `scripts/baselines/file-size.json` row rather than re-keying it: a move
 * cannot retire an exemption, only a split can.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

/** Anchored on FORGE_ROOT, not a hand-counted `..` chain (COMMON §15.14). */
const INSTRUCTIONS_KIND_TS = join(FORGE_ROOT, 'packages', 'sessions', 'kinds', 'instructions.ts');

// ---------------------------------------------------------------------------
// GREP-ASSERT — prose left the .ts and now lives in SKILL.md (AT-9, AT-10)
// ---------------------------------------------------------------------------

/**
 * At least 3 distinctive instruction sentences the design doc's mechanism
 * moves from the instructions kind into `skills/instructions-creator/SKILL.md`.
 * These are exact substrings copied from the instructions runner at base
 * commit `c45e3892` (then `orchestrator/instructions-runner.ts`, now
 * `packages/sessions/kinds/instructions.ts`), verified present there by grep
 * before this test was written.
 * (all three matched; see the WI-1 report for the exact commands run). Each
 * is a single, un-split JS string literal in the source today (no `+`
 * concatenation crosses the substring), so no source reconstruction is
 * needed on the .ts side — only whitespace-collapsing on the SKILL.md side,
 * where the mover is free to re-wrap the prose across markdown lines.
 */
const MOVED_SENTENCES = [
  'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the complete AGENTS.md content,',
  'Inspect the repo with your read tools, then decide whether you can write an',
  // T2 RULING (R4-23 round 2): this entry originally pinned
  // '...existing AGENTS.md ABOVE per the change-notes...'. That made AT-9 and
  // R2-AT-1a/b mutually unsatisfiable — R2-AT-1 forbids the stale positional
  // word "above" from reaching a live prompt, while this AT demanded the
  // sentence containing it be present in SKILL.md. The first implementer
  // "resolved" the contradiction by parking the superseded wording in a dead
  // `legacy-wording-archive` turn section no runner ever loads: prose added to
  // a shipped artifact purely to satisfy a grep. The AT was the defective
  // half, so it is corrected here — pin the clause that is INVARIANT under
  // re-anchoring (everything up to the positional word), not the positional
  // word itself. Recorded in the PR body.
  'You are UPDATING the existing AGENTS.md',
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

test('AT-9: the moved instruction prose has LEFT kinds/instructions.ts and now lives in SKILL.md (private loadSkillPrompt is gone)', () => {
  const runnerSrc = readFileSync(INSTRUCTIONS_KIND_TS, 'utf8');
  const skillMd = readFileSync(
    join(FORGE_ROOT, 'skills', 'instructions-creator', 'SKILL.md'),
    'utf8',
  );
  const collapsedRunner = collapseWhitespace(runnerSrc);
  const collapsedSkillMd = collapseWhitespace(skillMd);

  for (const sentence of MOVED_SENTENCES) {
    const needle = collapseWhitespace(sentence);
    assert.ok(
      !collapsedRunner.includes(needle),
      `expected this instruction sentence to have LEFT instructions-runner.ts: "${sentence}"`,
    );
    assert.ok(
      collapsedSkillMd.includes(needle),
      `expected this instruction sentence to now live in SKILL.md: "${sentence}"`,
    );
  }

  assert.ok(
    !runnerSrc.includes('loadSkillPrompt'),
    'the private loadSkillPrompt helper (and every call to it) must be gone from instructions-runner.ts',
  );
});

test('AT-10: no fail-open default-prompt literal remains in kinds/instructions.ts', () => {
  const runnerSrc = readFileSync(INSTRUCTIONS_KIND_TS, 'utf8');
  assert.ok(
    !runnerSrc.includes('You are the forge instructions-creator agent.'),
    'the fail-open fallback literal must be deleted — loadSkillTurnPrompt fails loud instead',
  );
});

// ---------------------------------------------------------------------------
// R2-AT-2 — no instruction content was silently dropped by the migration. A
// frozen list of every distinct instruction sentence the agent received
// BEFORE this refactor (base commit c45e3892), reconstructed from BOTH
// `skills/instructions-creator/SKILL.md` AND the two prompt-building arrays
// in `orchestrator/instructions-runner.ts` (interview + draft, both mode
// branches). Each entry must still be reachable in today's
// `skills/instructions-creator/SKILL.md` (whitespace-collapsed substring
// match) — either verbatim, or (where the mover deliberately generalised
// rather than kept the sentence verbatim) via a distinctive clause of it,
// noted inline. `## Turn shape` / `### Interview step` / `### Draft step`
// are section HEADERS, not instruction sentences, and are excluded — the
// content they introduced is covered by the sentences below (now under
// `<!-- turn: interview -->` / `<!-- turn: draft -->`). The unchanged
// preamble ("What AGENTS.md is for" bullets, the rest of "Read-only
// contract") is represented by two samples rather than exhaustively
// enumerated, since `git diff c45e3892 HEAD -- skills/instructions-creator/SKILL.md`
// shows ZERO diff hunks in that region — it is provably untouched, so
// per-bullet pins would only re-prove "identity is identity".
//
// Every entry below was verified against the base text with a throwaway
// whitespace-collapsed substring check before this test was written; only
// the "read manifests, CI config, ..." entry came back ABSENT from today's
// SKILL.md — that is the one real drop this AT pins.
//
// Reuses `collapseWhitespace` already defined above (AT-9's helper).
// ---------------------------------------------------------------------------

type FrozenSentence = { source: string; sentence: string; note?: string };

const FROZEN_SENTENCES_BASE_C45E3892: FrozenSentence[] = [
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence:
      'Decide whether you have enough to write a coherent, accurate AGENTS.md WITHOUT unresolved ' +
      'ambiguity about commands, conventions, or constraints.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence: 'read manifests, CI config, existing CLAUDE.md/AGENTS.md, a few source files',
    note:
      'GENUINELY DROPPED — the full base sentence was "First inspect the repo (read manifests, ' +
      'CI config, existing CLAUDE.md/AGENTS.md, a few source files)." This distinctive clause ' +
      '(WHAT to inspect) survives nowhere post-refactor: only the generic "Inspect the repo with ' +
      'your read tools, then decide..." sentence (sourced from instructions-runner.ts, see below) ' +
      'remains. This entry is EXPECTED TO FAIL right now — it is the pin for the review finding.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence:
      "Ask only what unblocks an accurate draft — things the code cannot tell you (intended " +
      "audience, what's off-limits, release conventions).",
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence: 'Stop as soon as more questions would only refine.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence: 'question, header ≤12 chars, 2–4 options each with label + description',
    note:
      'Base wraps this clause in "AskUserQuestion shape (...)"; today it reads "AskUserQuestion ' +
      'shape: ...". Re-wrapped, not reworded — pin the clause, not the wrapper punctuation.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (draft step, base)',
    sentence: "Fold in the operator's interview answers and any resolved revision feedback.",
  },
  {
    source: 'skills/instructions-creator/SKILL.md (draft step, base)',
    sentence: "Lead with the project's purpose; keep every command copied-accurate; keep it tight.",
  },
  {
    source: 'skills/instructions-creator/SKILL.md (draft step, base — no composed_seed_ids field yet)',
    sentence: 'the complete AGENTS.md content, ready to write verbatim to the repo root.',
    note:
      "Base SKILL.md's Return-shape lacked composed_seed_ids (that field lived only in the " +
      'runner .ts at base — see the init-draft-branch entry below); pin the clause the two ' +
      'versions share rather than either exact "Return {...}" literal.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md ("## Turn shape" framing, base)',
    sentence: 'and the interview so far',
    note:
      "Base: \"Each turn the runner gives you the project, the operator's brief, and the " +
      'interview so far, and asks you for ONE of two structured outputs:". The data-block framing ' +
      "sentence was deliberately reworded (it now also explains the Mode: line) — pin the clause " +
      'common to both rather than the whole sentence.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runInterviewStep, edit-mode branch, base)',
    // T2 RULING (R4-23 round 2): split around the positional word "above",
    // which R2-AT-1a/b legitimately forbids from reaching a live prompt (the
    // `## Existing AGENTS.md` data block it referred to is now BELOW the skill
    // text, not above it). Pinning the whole original sentence would have made
    // the two ATs mutually unsatisfiable and forced dead prose into the shipped
    // SKILL.md. Both halves of the instruction are still pinned — only the
    // stale positional word is released. Recorded in the PR body.
    sentence: 'You are UPDATING the existing AGENTS.md',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runInterviewStep, edit-mode branch, base) — second half',
    sentence:
      'per the change-notes. You can usually ' +
      'proceed without questions — return `{ "done": true }`. Only return ' +
      '`{ "done": false, "questions": [...] }` (1-4 AskUserQuestion-shaped) if a note is genuinely ambiguous.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runInterviewStep, init-mode branch, base)',
    sentence:
      'Inspect the repo with your read tools, then decide whether you can write an accurate ' +
      'AGENTS.md without unresolved ambiguity. If yes, return `{ "done": true }`. Otherwise ' +
      'return `{ "done": false, "questions": [...] }` with 1-4 high-leverage questions in the AskUserQuestion shape.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runDraftStep, edit-mode branch, base)',
    // T2 RULING (R4-23 round 2): split around the positional word "above" —
    // same reasoning as the interview edit-mode entry above.
    sentence:
      'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the existing ' +
      'AGENTS.md',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runDraftStep, edit-mode branch, base) — second half',
    sentence:
      ", REVISED to incorporate the operator's change-notes. Preserve everything " +
      'they did not ask to change; keep commands copy-accurate; keep it tight. List any seed ids ' +
      'you composed from in composed_seed_ids.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runDraftStep, init-mode branch, base)',
    sentence:
      'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the complete ' +
      'AGENTS.md content, ready to write verbatim to the repo root. Keep commands copy-accurate; ' +
      'keep it tight. List any seed ids you composed from in composed_seed_ids ([] if none applied).',
  },
  {
    source:
      'skills/instructions-creator/SKILL.md (unchanged preamble sample 1 — proves the untouched region is still covered)',
    sentence:
      "Author the project's **AGENTS.md** — the single source of agent instructions for a " +
      'managed project — the way `claude init` does: explore the real code, ask the operator ' +
      'what only they can answer, draft, and let them confirm or revise before anything is written.',
  },
  {
    source:
      'skills/instructions-creator/SKILL.md (unchanged preamble sample 2 — proves the untouched region is still covered)',
    sentence: 'You have read tools only (Read, Grep, Glob, Bash). You never write files.',
  },
];

test("R2-AT-2: every distinct pre-refactor instruction sentence (SKILL.md + both instructions-runner.ts prompt arrays, base c45e3892) is still reachable in today's SKILL.md", () => {
  const skillMd = readFileSync(
    join(FORGE_ROOT, 'skills', 'instructions-creator', 'SKILL.md'),
    'utf8',
  );
  const collapsedSkillMd = collapseWhitespace(skillMd);

  const missing = FROZEN_SENTENCES_BASE_C45E3892.filter(
    ({ sentence }) => !collapsedSkillMd.includes(collapseWhitespace(sentence)),
  );

  assert.deepEqual(
    missing.map((m) => `[${m.source}] "${m.sentence}"${m.note ? ` — ${m.note}` : ''}`),
    [],
    'every pre-refactor instruction sentence/clause must still be reachable in SKILL.md; the ' +
      'array above (if non-empty) names exactly what was silently dropped',
  );
});
