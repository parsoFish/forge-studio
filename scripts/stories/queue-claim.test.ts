/**
 * The queue writes a costed run is ANSWERABLE FOR — bead `forge-8vfn.7.6.74`.
 *
 * WHAT THIS COSTS WHEN IT IS MISSING. S10 run 14's cycle minted
 * `INIT-2026-09-12-init-exclude-author-flag.md` into `_queue/ready-for-review/`
 * at 04:25:27Z. Neither the story sweep (which targets `_queue/in-flight|failed/
 * STORY-<id>.md` and nothing else) nor the launcher's release path covered that
 * state, so it sat for thirteen hours. `.gitignore:42` is
 * `_queue/ready-for-review/*`, so `git status --porcelain` read 0 the whole
 * time — and "porcelain 0" was quoted as clean-tree evidence in the run 15
 * INTENT. `queueStateVerdict` (§15.430) then refused run 15 attempt 2 at $0,
 * its first live fire on real residue.
 *
 * WHY IT IS A WRONG-GREEN AND NOT AN UNTIDY TREE. A gitpulse initiative already
 * resting in `ready-for-review` can satisfy S10 beat 8's `initiative-status`
 * conjunct BEFORE the run dispatches anything. That is a $35 run reporting a
 * pass it did not earn — the same class as a filtered listing read as an empty
 * one, and the reason §15.427 puts the queue census inside the lock.
 *
 * ATTRIBUTION, NOT A GLOB. A story id cannot find these files: the cycle names
 * them after the initiative, not after the story. So a file is this run's when
 * its `created_at` falls inside the run's window OR its `project` is the
 * story's own ground, and it is NOT this run's otherwise — and the difference
 * is reported either way, because a file left behind silently is what produced
 * the thirteen hours.
 *
 * CAPTURE-FIRST, AND FAIL CLOSED. Nothing is removed before its bytes are in
 * the run's evidence directory, and nothing is removed that could not be
 * attributed. A manifest whose front matter will not parse is named and LEFT:
 * the next run's `queueStateVerdict` then refuses at $0, which is the correct
 * end state for "I could not tell whose this is".
 *
 * THE FIXTURES ARE PRODUCT-WRITTEN (§15.497). Every manifest below is
 * serialised by `writeManifest` from `packages/flows/manifest.ts` — the same
 * choke point the cycle writes through — rather than typed as a front-matter
 * string here. A hand-written fixture would encode this test's belief about the
 * format twice and agree with itself.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest, type InitiativeManifest } from '../../packages/flows/manifest.ts';
import { claimQueueWrites } from './queue-claim.mjs';

const QUEUE_STATES = ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed'];

function manifest(id: string, project: string, createdAt: string): InitiativeManifest {
  return {
    initiative_id: id,
    project,
    project_repo_path: '',
    created_at: createdAt,
    iteration_budget: 3,
    cost_budget_usd: 5,
    phase: 'pending',
    origin: 'architect',
    class: 'code',
    acceptance_criteria: [{ given: 'a ground', when: 'a cycle runs', then: 'an initiative exists' }],
    body: '# test initiative\n',
  } as InitiativeManifest;
}

/** A forge root with the six queue states, and the manifests placed where the
 *  cycle would have left them — written by the PRODUCT, then moved. */
function rootWith(entries: { id: string; project: string; createdAt: string; state: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), 'queue-claim-'));
  for (const q of QUEUE_STATES) mkdirSync(join(root, '_queue', q), { recursive: true });
  for (const e of entries) {
    const written = writeManifest(manifest(e.id, e.project, e.createdAt), { queueRoot: join(root, '_queue') });
    if (e.state !== 'pending') renameSync(written, join(root, '_queue', e.state, `${e.id}.md`));
  }
  return root;
}

const RUN_START = Date.parse('2026-09-12T04:17:00Z');
const RUN_END = Date.parse('2026-09-12T05:30:00Z');
/** Run 14's own residue: minted mid-run, into the state nothing swept. */
const IN_WINDOW = { id: 'INIT-2026-09-12-init-exclude-author-flag', project: 'gitpulse', createdAt: '2026-09-12T04:25:27.000Z', state: 'ready-for-review' };
/** A neighbour's initiative from before this run, on another ground. */
const OUT_OF_WINDOW = { id: 'INIT-2026-09-01-someone-elses', project: 'mdtoc', createdAt: '2026-09-01T09:00:00.000Z', state: 'pending' };

describe('claimQueueWrites: which queue files this run is answerable for', () => {
  test('7.6.74: an in-window INIT in ready-for-review is CAPTURED and then removed', () => {
    const root = rootWith([IN_WINDOW]);
    const evidence = join(root, 'evidence');
    const r = claimQueueWrites({ root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse', evidenceDir: evidence });

    assert.equal(r.claimed.length, 1, JSON.stringify(r, null, 2));
    assert.equal(r.claimed[0]!.state, 'ready-for-review');
    assert.equal(existsSync(join(root, '_queue', 'ready-for-review', `${IN_WINDOW.id}.md`)), false, 'the residue must be gone');
    const captured = join(evidence, 'ready-for-review', `${IN_WINDOW.id}.md`);
    assert.ok(existsSync(captured), `captured before removal, at ${captured}`);
    assert.match(readFileSync(captured, 'utf8'), /initiative_id/, 'and the capture is the bytes, not a summary');
  });

  test('7.6.74: an out-of-window INIT on another ground is LEFT, and NAMED', () => {
    const root = rootWith([OUT_OF_WINDOW]);
    const r = claimQueueWrites({ root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse', evidenceDir: join(root, 'evidence') });

    assert.deepEqual(r.claimed, [], 'nothing of this run is here');
    assert.equal(r.left.length, 1);
    assert.equal(existsSync(join(root, '_queue', 'pending', `${OUT_OF_WINDOW.id}.md`)), true, 'it is not ours to remove');
    assert.ok(
      r.lines.some((l) => l.includes(OUT_OF_WINDOW.id)),
      `a file left behind SILENTLY is what cost thirteen hours: ${r.lines.join(' | ')}`,
    );
  });

  test('7.6.74: the ground\'s own project is claimed even from outside the window', () => {
    const stale = { ...OUT_OF_WINDOW, project: 'gitpulse' };
    const r = claimQueueWrites({
      root: rootWith([stale]), sinceMs: RUN_START, untilMs: RUN_END,
      groundProject: 'gitpulse', evidenceDir: join(mkdtempSync(join(tmpdir(), 'ev-')), 'e'),
    });
    assert.equal(r.claimed.length, 1, `the ground is the story's own, so its residue is the story's: ${JSON.stringify(r.left)}`);
    assert.match(r.claimed[0]!.reason, /ground/);
  });

  test('7.6.74: every one of the six states is looked in, not just the two the old sweep knew', () => {
    const entries = QUEUE_STATES.map((state, i) => ({
      id: `INIT-2026-09-12-state-${i}`, project: 'gitpulse',
      createdAt: '2026-09-12T04:25:27.000Z', state,
    }));
    const r = claimQueueWrites({
      root: rootWith(entries), sinceMs: RUN_START, untilMs: RUN_END,
      groundProject: 'gitpulse', evidenceDir: join(mkdtempSync(join(tmpdir(), 'ev-')), 'e'),
    });
    assert.equal(r.claimed.length, 6, `one per state: ${r.claimed.map((c) => c.state).join(', ')}`);
    assert.deepEqual([...new Set(r.claimed.map((c) => c.state))].sort(), [...QUEUE_STATES].sort());
  });

  test('7.6.74: a manifest that will not parse is NAMED and LEFT — it is not ours to guess about', () => {
    const root = rootWith([]);
    const bad = join(root, '_queue', 'ready-for-review', 'INIT-2026-09-12-unreadable.md');
    writeFileSync(bad, '---\nthis: [is not: valid yaml\n---\nbody\n');
    const r = claimQueueWrites({ root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse', evidenceDir: join(root, 'evidence') });

    assert.equal(r.claimed.length, 0);
    assert.equal(r.unattributable.length, 1, JSON.stringify(r, null, 2));
    assert.equal(existsSync(bad), true, 'fail CLOSED: what cannot be attributed is never removed');
    assert.ok(r.lines.some((l) => /unreadable/.test(l) && /COULD NOT ATTRIBUTE/.test(l)), r.lines.join(' | '));
  });

  test('7.6.74: a manifest with no created_at AND no project is unattributable, not claimed by default', () => {
    const root = rootWith([]);
    const bare = join(root, '_queue', 'done', 'INIT-2026-09-12-bare.md');
    writeFileSync(bare, '---\ninitiative_id: INIT-2026-09-12-bare\n---\nbody\n');
    const r = claimQueueWrites({ root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse', evidenceDir: join(root, 'evidence') });
    assert.equal(r.unattributable.length, 1);
    assert.equal(existsSync(bare), true);
  });

  test('7.6.74: CAPTURE-FIRST — if the capture fails the file STAYS', () => {
    const root = rootWith([IN_WINDOW]);
    const r = claimQueueWrites({
      root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse',
      evidenceDir: join(root, 'evidence'),
      capture: () => { throw new Error('disk full'); },
    });
    assert.equal(r.claimed.length, 0);
    assert.equal(r.failed.length, 1, JSON.stringify(r, null, 2));
    assert.equal(
      existsSync(join(root, '_queue', 'ready-for-review', `${IN_WINDOW.id}.md`)), true,
      'a removal whose capture failed would destroy the only copy of the evidence',
    );
    assert.ok(r.lines.some((l) => /disk full/.test(l)), r.lines.join(' | '));
  });

  test('7.6.74: a file that is not an INIT manifest is left alone and said so', () => {
    const root = rootWith([]);
    writeFileSync(join(root, '_queue', 'in-flight', 'STORY-s10.md'), 'not an initiative\n');
    const r = claimQueueWrites({ root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse', evidenceDir: join(root, 'evidence') });
    assert.equal(r.claimed.length, 0);
    assert.equal(r.unattributable.length, 0, 'a STORY file is the story-id sweep\'s job, not an attribution failure');
    assert.ok(r.lines.some((l) => l.includes('STORY-s10.md')), r.lines.join(' | '));
  });

  test('7.6.74: an absent queue is reported, never counted as clean', () => {
    const root = mkdtempSync(join(tmpdir(), 'queue-claim-none-'));
    const r = claimQueueWrites({ root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse', evidenceDir: join(root, 'evidence') });
    assert.equal(r.ok, false, 'an absent path is not an empty one (§15.430)');
    assert.ok(r.lines.some((l) => /_queue/.test(l)), r.lines.join(' | '));
  });

  test('7.6.74: a clean queue says so with the per-state census, not with silence', () => {
    const r = claimQueueWrites({
      root: rootWith([]), sinceMs: RUN_START, untilMs: RUN_END,
      groundProject: 'gitpulse', evidenceDir: join(mkdtempSync(join(tmpdir(), 'ev-')), 'e'),
    });
    assert.equal(r.ok, true);
    assert.equal(r.claimed.length, 0);
    for (const q of QUEUE_STATES) {
      assert.ok(r.lines.some((l) => l.includes(`${q}/`)), `${q} must appear in the census: ${r.lines.join(' | ')}`);
    }
  });
});

/**
 * THE `Date` SHAPE, which the product does not write and something else might.
 *
 * `serializeManifest` quotes the timestamp, so gray-matter returns a string and
 * every product-written manifest takes that path. An UNQUOTED ISO timestamp is
 * equally valid YAML — a hand-edited manifest, or one from another writer — and
 * js-yaml parses it into a `Date`.
 *
 * This door exists because a mutation deleting the `Date` branch passed all ten
 * tests above: the branch was defensible and undoored, which is the same
 * "nothing proves this" the bead itself is about. The fixture's project is
 * deliberately NOT the ground, so `created_at` is the only thing that can claim
 * it — without the branch it reads as unattributable and reds.
 */
test('7.6.74: an UNQUOTED created_at (a Date after YAML parsing) still attributes by window', () => {
  const root = mkdtempSync(join(tmpdir(), 'queue-claim-date-'));
  for (const q of QUEUE_STATES) mkdirSync(join(root, '_queue', q), { recursive: true });
  const path = join(root, '_queue', 'ready-for-review', 'INIT-2026-09-12-unquoted.md');
  writeFileSync(path, [
    '---',
    'initiative_id: INIT-2026-09-12-unquoted',
    'project: some-other-ground',
    'created_at: 2026-09-12T04:25:27.000Z',
    '---',
    '# hand-written\n',
  ].join('\n'));

  const r = claimQueueWrites({
    root, sinceMs: RUN_START, untilMs: RUN_END, groundProject: 'gitpulse',
    evidenceDir: join(root, 'evidence'),
  });

  assert.equal(r.unattributable.length, 0, `a Date is a created_at: ${JSON.stringify(r.unattributable)}`);
  assert.equal(r.claimed.length, 1, `claimed by window alone: ${JSON.stringify(r, null, 2)}`);
  assert.match(r.claimed[0]!.reason, /inside this run/);
  assert.equal(existsSync(path), false);
});
