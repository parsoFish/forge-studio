/**
 * `classifyCycleFailure` against five cycles that actually ran.
 *
 * T1 ruling 507. Four of the campaign's six archived cycles ended with the
 * classifier saying **"failure could not be classified — examine events.jsonl
 * manually"** — and it said it LIVE, in production, in each cycle's own
 * `failure_classification` event. Every one of those four died the same way:
 *
 *   project-manager / error   (no message, `set_errors` in its metadata)
 *   orchestrator   / error    project-manager phase failed: set errors:
 *                             WI-3: creates is required (ADR 037) unless
 *                             verification_artifact is set …
 *
 * The cycle knew exactly what was wrong, named the work item, named the field
 * and named the ADR — and the diagnosis handed to the scheduler and to whoever
 * read the report was "go and grep the log yourself". That is the whole cost of
 * this defect: not a wrong verdict, an ABSENT one, on the failure mode this
 * ground produced four times in six hours.
 *
 * THE PREDICATE, and why it missed. `pmInvalidWorkItems` was gated on
 * `md.per_item_error_count > 0`. The PM writes TWO metadata fields —
 * `set_errors` (validation failures for the work-item SET: a missing `creates`,
 * a dangling dependency) and `per_item_error_count` (failures scoped to one
 * item). A set-level failure leaves the per-item count at 0, so the branch that
 * exists for "the PM emitted schema-invalid WIs" never fired for the most
 * common way the PM emits schema-invalid WIs.
 *
 * The verdict it now reaches is the one that was always right for this shape:
 * terminal, no auto-retry, because the same decomposition re-runs the same
 * validation errors. Nothing about the classification's SHAPE changes — one
 * disjunct on one line, and a reason string that now names both fields it may
 * be talking about.
 *
 * WHY REPLAY REAL LOGS. A hand-written event shaped like what we expect the PM
 * to emit would have passed on the day this defect shipped. These fixtures are
 * the real thing, trimmed to exactly the window the classifier reads
 * (`test-fixtures/cycle-traces/README.md` has the provenance and the proof of
 * each trim), and each one is pinned to the verdict its cycle recorded live —
 * so a fixture that stops matching has found a real change, and the table says
 * which change.
 *
 * A NOTE ON READING ARCHIVED LOGS, because it cost an hour. Replaying a whole
 * archived `events.jsonl` replays the WRONG WINDOW: `windowSinceLastPhaseStart`
 * slices from the last `start` in whatever it is handed, and these logs kept
 * growing for hundreds of events after the classifier read them — three of
 * these four end in `reflector.end`, a SUCCESS. Replayed whole, they look like
 * a classifier being asked about a cycle that did not fail. The faithful input
 * is the prefix ending at the log's own `failure_classification` event, which
 * is what the fixtures are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventLogEntry } from '@forge/kernel';
import { classifyCycleFailure } from '../../failure-classifier.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'test-fixtures/cycle-traces');

const read = (name: string): EventLogEntry[] =>
  readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as EventLogEntry);

/**
 * One row per archived cycle: what it really was, and the verdict the
 * classifier must reach. `wasBeforeTheFix` is not decoration — it is what makes
 * this a regression tier rather than a snapshot: it records the sentence a real
 * operator actually got.
 */
const CYCLES = [
  {
    file: '2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter.jsonl',
    what: 'gitpulse --exclude path filter: PM emitted 3 WIs, WI-3 had no `creates` (ADR 037)',
    wasBeforeTheFix: 'failure could not be classified — examine events.jsonl manually',
    kind: 'terminal',
    reasonMatches: /^PM emitted schema-invalid WIs — deterministic/,
  },
  {
    file: '2026-07-11T14-57-10_INIT-2026-07-11-csv-output-flag.jsonl',
    what: 'gitpulse --csv: PM emitted 4 WIs, WI-2 and WI-4 had no `creates`',
    wasBeforeTheFix: 'failure could not be classified — examine events.jsonl manually',
    kind: 'terminal',
    reasonMatches: /^PM emitted schema-invalid WIs — deterministic/,
  },
  {
    file: '2026-07-11T16-18-59_INIT-2026-07-11-init-2026-07-12-tags-command.jsonl',
    what: 'gitpulse tags subcommand: PM emitted 4 WIs, WI-4 had no `creates`',
    wasBeforeTheFix: 'failure could not be classified — examine events.jsonl manually',
    kind: 'terminal',
    reasonMatches: /^PM emitted schema-invalid WIs — deterministic/,
  },
  {
    file: '2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag.jsonl',
    what: 'gitpulse --sort: PM emitted 3 WIs, WI-3 had no `creates`',
    wasBeforeTheFix: 'failure could not be classified — examine events.jsonl manually',
    kind: 'terminal',
    reasonMatches: /^PM emitted schema-invalid WIs — deterministic/,
  },
  {
    // THE CONTROL. This cycle failed a different way and was classified
    // correctly all along, so it must be UNTOUCHED by the fix. Without it,
    // "classify the PM set-error shape" could be satisfied by a predicate that
    // classifies everything as an invalid-WI failure.
    file: '2026-08-03T01-16-00_INIT-2026-08-03-init-coupling-change-coupling-command.jsonl',
    what: 'gitpulse coupling subcommand: the delivery gate\'s demo pipeline failed (author-invalid)',
    wasBeforeTheFix: 'the demo pipeline failed (author-invalid / capture tooling / scope violation / budget)',
    kind: 'terminal',
    reasonMatches: /^the demo pipeline failed/,
  },
] as const;

for (const cycle of CYCLES) {
  test(`507: ${cycle.file.slice(0, 19)} — ${cycle.what}`, () => {
    const verdict = classifyCycleFailure(read(cycle.file));

    assert.equal(verdict.kind, cycle.kind, `kind, on a real cycle. Reason was: ${verdict.reason}`);
    assert.match(
      verdict.reason,
      cycle.reasonMatches,
      `this cycle used to be told "${cycle.wasBeforeTheFix}". Got: ${verdict.reason}`,
    );
  });
}

test('507: every fixture names its own evidence — a verdict with no event behind it is a guess', () => {
  // `evidence_event_ids` is what turns a sentence into something an operator can
  // go and look at. The unclassified verdict returned an EMPTY list, which is
  // consistent — it had found nothing — and is exactly what must stop being
  // true for these four.
  for (const cycle of CYCLES) {
    const verdict = classifyCycleFailure(read(cycle.file));
    assert.ok(
      verdict.evidence_event_ids.length > 0,
      `${cycle.file}: classified "${verdict.reason}" while pointing at no event`,
    );
  }
});

test('507: the fixture set is the committed one — a trace deleted from disk is not silently skipped', () => {
  // A table-driven replay whose files are read by name will pass with a
  // vanished fixture only if nothing checks the directory. This is that check.
  const onDisk = readdirSync(FIXTURES).filter((f) => f.endsWith('.jsonl')).sort();
  assert.deepEqual(
    onDisk,
    CYCLES.map((c) => c.file).sort(),
    'every committed trace is replayed, and every replayed trace is committed',
  );
});
