/**
 * The `unattributed` chunk must be able to produce a VALID review record.
 *
 * G2 resume 5 (2026-09-08) died here, on its last chunk, after every other
 * chunk had passed and the budget wall had not fired once. The reviewer
 * returned `author-invalid: acEvaluations judges a criterion this initiative
 * never declared` twice and exhausted its attempts.
 *
 * IT HAD INVENTED NOTHING. The criterion it judged is `WI-1.md`'s own, copied
 * character-for-character in the pipeline's own `(WI-N) GIVEN…WHEN…THEN`
 * rendering. The mechanism is two lines of product code:
 *
 *   - `adversarial-review.ts` gives a chunk with `workItemId === null` an EMPTY
 *     expected-criteria set, which is the design (each chunk is validated
 *     against its own criteria; the merged record is validated against the
 *     whole initiative's, and work items with no chunk are supplied by the
 *     orchestrator at merge time).
 *   - The prompt for such a chunk said only "no acceptance criteria recorded —
 *     review the diff on its own merits", and then listed the work items
 *     immediately below it. The skill contract says "one entry per criterion
 *     the prompt listed" and that `acEvaluations` is checked by exact set
 *     membership, so an agent shown work items reaches for their criteria.
 *
 * The chunk's only valid record is one that judges NOTHING, and nothing told
 * the reviewer that. These cases pin both halves of the fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderAdversarialReviewUserPrompt } from '../../phases/adversarial-review-binding.ts';
import { validateReviewFindings } from '@forge/flows/flow-artifacts.ts';

/** The exact string G2's reviewer submitted and was refused for — WI-1.md's own
 *  first criterion, in the pipeline's own rendering. Not a paraphrase of it. */
const G2_CRITERION =
  '(WI-1) GIVEN a clean worktree before any matrix normalization WHEN `scripts/gates/gap-registry-foundation.sh` is executed THEN `docs/gap-registry.md` exists, contains a `## Vocabulary` section defining exactly the four canonical tokens (`covered`, `gap-open`, `gap-deferred`, `out-of-scope`), and the gate script exits 0';

const unattributedPrompt = () =>
  renderAdversarialReviewUserPrompt({
    initiativeId: 'INIT-2026-09-05-init-gap-registry-consolidation',
    cycleId: '2026-09-05T13-37-42_INIT-2026-09-05-init-gap-registry-consolidation',
    baseRef: 'main',
    headSha: 'deadbeef',
    // The chunk's own set — empty, by design, for `unattributed`.
    acceptanceCriteria: [],
    // …and the work items are still listed, which is what the agent reached for.
    workItems: [
      { id: 'WI-1', status: 'done', title: 'Foundation' },
      { id: 'WI-2', status: 'done', title: 'Normalize matrices' },
    ],
    changedFiles: ['docs/gap-registry.md'],
    lenses: ['correctness'],
    brainContext: [],
  });

test('the unattributed chunk is TOLD to judge nothing, not merely told there are no criteria', () => {
  const p = unattributedPrompt();
  // The old wording — "review the diff on its own merits" — is an instruction
  // about the FINDINGS, and says nothing about `acEvaluations`. An agent that
  // reads it and then sees the work-item list below has been told nothing that
  // stops it judging their criteria.
  assert.match(
    p,
    /acEvaluations/,
    'a chunk with no criteria must name `acEvaluations` explicitly and say it belongs empty',
  );
  assert.match(
    p,
    /empty/i,
    'the prompt must say the evaluation list is EMPTY for this chunk, not merely that no criteria were recorded',
  );
});

test('the work items listed for a criteria-less chunk are marked as context, judged elsewhere', () => {
  const p = unattributedPrompt();
  const wiIndex = p.indexOf('WI-1');
  assert.ok(wiIndex > 0, 'sanity: the work items are still listed');
  // Whatever the wording, the prompt must tell the agent that these items'
  // criteria are NOT its to judge — otherwise the list is an invitation.
  // Curly quotes folded to ASCII first: this pins the CLAIM, not the typography,
  // and a test that fails on an apostrophe teaches nothing.
  const flat = p.replace(/[\u2018\u2019]/g, "'");
  assert.match(flat, /not this chunk's to judge/i, 'the work-item list must disown these criteria for this chunk');
  assert.match(flat, /judged by their own chunks|at merge/i, 'and must say where they ARE judged');
});

test('the rejection names the SET it compared, never "the initiative"', () => {
  // The message a human reads decides what they conclude. "a criterion this
  // initiative never declared" reads as "the agent hallucinated" — and the
  // initiative HAD declared it. The comparison is against the chunk's set.
  const errs = validateReviewFindings(
    {
      initiative_id: 'INIT-x', cycleId: 'c', baseRef: 'main', headSha: 'h',
      reviewedAt: '2026-09-08T00:00:00Z', summary: 's',
      findings: [],
      lenses: ['correctness'],
      acEvaluations: [{ criterion: G2_CRITERION, verdict: 'met', evidence: 'read the gate script' }],
      whyWhatHow: { why: 'w', what: 'w', how: 'h' },
    },
    { lenses: ['correctness'], criteria: [], scope: 'chunk unattributed' },
  );
  const judged = errs.filter((e) => e.includes(G2_CRITERION));
  assert.equal(judged.length, 1, `expected exactly one rejection naming the criterion, got: ${errs.join(' | ')}`);
  assert.doesNotMatch(judged[0]!, /this initiative never declared/, 'the message must not claim the initiative never declared it');
  assert.match(judged[0]!, /chunk unattributed/, 'the message must name the set it compared against');
});

test('a criteria-less chunk that judges NOTHING is valid — the record it is now told to write', () => {
  const errs = validateReviewFindings(
    {
      initiative_id: 'INIT-x', cycleId: 'c', baseRef: 'main', headSha: 'h',
      reviewedAt: '2026-09-08T00:00:00Z', summary: 's',
      findings: [],
      lenses: ['correctness'],
      acEvaluations: [],
      whyWhatHow: { why: 'w', what: 'w', how: 'h' },
    },
    { lenses: ['correctness'], criteria: [], scope: 'chunk unattributed' },
  );
  assert.deepEqual(errs, [], `an empty evaluation set against an empty expected set must be valid, got: ${errs.join(' | ')}`);
});
