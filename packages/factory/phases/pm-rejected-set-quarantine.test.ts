/**
 * bead forge-8vfn.6.1 (P0) — the validation gate with no teeth, reproduced live by
 * G1 run 3 on 2026-09-04 and merged to a real project because of it.
 *
 * WHAT HAPPENED. The PM's own ADR-037 validation failed the set it had just
 * written (`WI-3: creates is required … unless verification_artifact is set`) and
 * the phase correctly returned `{kind: 'failure'}`. Nine seconds later the
 * scheduler claimed the same initiative, the dev-loop ran those three work items
 * to 3/3 complete, and the result MERGED as gitpulse #15 and cut release 0.14.0.
 *
 * WHY IT COULD. The phase was never missing a check. `validateWorkItemSet` runs,
 * the failure is returned, and `persistManifestSpecs` is correctly gated behind
 * `if (!failed)` — the manifest's `specs` back-reference is withheld exactly as
 * intended. But the agent's turn writes the work-item FILES into
 * `.forge/work-items/` BEFORE validation, and every downstream claimant reads
 * that DIRECTORY, not the manifest (`enqueue-flow-run.ts:321 hasWorkItemFiles`,
 * `cycle.ts:344`, `fix-work-items.ts:36`, `requeue-resume.ts:125`). The declared
 * POINTER was withheld while the PAYLOAD stayed readable — §15.167, a gate on the
 * wrong artifact.
 *
 * So the fix is not another check. A rejected set must stop being claimable, and
 * it must stay readable for diagnosis: it is MOVED, not deleted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORK_ITEM_FILE_PATTERN } from '@forge/flows/work-item.ts';
import { quarantineRejectedSet, rejectWorkItemSet } from './pm-rejected-set.ts';

/** The claim predicate every downstream reader uses, copied from enqueue-flow-run.ts:321. */
function hasWorkItemFiles(dir: string): boolean {
  try { return readdirSync(dir).some((f) => WORK_ITEM_FILE_PATTERN.test(f)); } catch { return false; }
}

function seedSet(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-pm-reject-'));
  const dir = join(root, '.forge', 'work-items');
  mkdirSync(dir, { recursive: true });
  for (const id of ['WI-1', 'WI-2', 'WI-3']) {
    writeFileSync(join(dir, `${id}.md`), `---\nwork_item_id: ${id}\n---\n\nbody\n`);
  }
  writeFileSync(join(dir, '_graph.md'), '# graph\n');
  return { root, dir };
}

test('AT-1: after a rejected set is quarantined, NOTHING is claimable — the predicate every downstream reader uses returns false', () => {
  const { root, dir } = seedSet();
  try {
    assert.equal(hasWorkItemFiles(dir), true, 'precondition: the set is claimable before the fix runs');
    quarantineRejectedSet(dir, ['WI-3: creates is required (ADR 037)']);
    assert.equal(hasWorkItemFiles(dir), false,
      'a rejected set that still satisfies hasWorkItemFiles is the live defect: the dev-loop claims it');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AT-2: the work items are MOVED, not deleted — a rejected set is evidence and must stay readable', () => {
  const { root, dir } = seedSet();
  try {
    const res = quarantineRejectedSet(dir, ['WI-3: creates is required (ADR 037)']);
    assert.ok(res.movedTo && existsSync(res.movedTo), 'the quarantine directory must exist');
    const moved = readdirSync(res.movedTo as string).sort();
    assert.deepEqual(moved.filter((f) => WORK_ITEM_FILE_PATTERN.test(f)).sort(), ['WI-1.md', 'WI-2.md', 'WI-3.md'],
      'every work item is preserved for diagnosis');
    assert.equal(res.count, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AT-3: the quarantine records WHY, so the next reader is not left guessing at three plausible work items', () => {
  const { root, dir } = seedSet();
  try {
    const res = quarantineRejectedSet(dir, ['WI-3: creates is required (ADR 037)', 'WI-1: duplicate id']);
    assert.ok(res.movedTo, 'a seeded set must have been moved');
    const names = readdirSync(res.movedTo);
    const reasonFile = names.find((n) => /reject|reason|errors/i.test(n)) as string;
    assert.ok(reasonFile, `the quarantine must carry its set errors; found ${JSON.stringify(names)}`);
    const body = readFileSync(join(res.movedTo as string, reasonFile), 'utf8');
    assert.match(body, /creates is required/);
    assert.match(body, /duplicate id/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AT-4: quarantining twice does not lose the first set (two failed passes, two directories)', () => {
  const { root, dir } = seedSet();
  try {
    const first = quarantineRejectedSet(dir, ['first failure']);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'WI-1.md'), '---\nwork_item_id: WI-1\n---\n\nsecond\n');
    const second = quarantineRejectedSet(dir, ['second failure']);
    assert.notEqual(first.movedTo, second.movedTo, 'a second rejection must not overwrite the first ones evidence');
    assert.ok(first.movedTo && second.movedTo, 'both rejections must have moved something');
    assert.ok(existsSync(first.movedTo) && existsSync(second.movedTo));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AT-5: an empty or missing directory is a no-op, not a throw — the failure path must not fail', () => {
  const { root, dir } = seedSet();
  try {
    rmSync(dir, { recursive: true, force: true });
    const res = quarantineRejectedSet(dir, ['whatever']);
    assert.equal(res.count, 0);
    assert.equal(res.movedTo, null, 'nothing to quarantine means nothing was moved');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AT-6: rejectWorkItemSet IS the failure — it quarantines and returns failure in one act, so neither can be forgotten', () => {
  const { root, dir } = seedSet();
  try {
    const res = rejectWorkItemSet(dir, 'set errors: WI-3: creates is required (ADR 037)');
    assert.equal(res.kind, 'failure');
    assert.match(res.summary, /creates is required/, 'the original reason survives');
    assert.match(res.summary, /not claimable/, 'the caller is told the set was withdrawn');
    assert.equal(hasWorkItemFiles(dir), false, 'and it actually was');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AT-7 (sibling sweep): NO failure return in project-manager.ts bypasses rejectWorkItemSet', () => {
  // Not a style check. G1 run 3 exercised the post-validation failure; the
  // brain-mandate failure two hundred lines above it returns AFTER the agent's
  // turn and had the identical hole. Fixing only the path a live run happened to
  // take is how the sibling-route class survives, so the property is pinned:
  // the phase's ONLY `kind: 'failure'` occurrence is its return-type declaration.
  const src = readFileSync(new URL('./project-manager.ts', import.meta.url), 'utf8');
  const raw = src.split('\n').filter((l) => /kind:\s*'failure'/.test(l));
  assert.equal(raw.length, 1, `expected only the type declaration, found:\n${raw.join('\n')}`);
  assert.match(raw[0], /\|\s*\{ kind: 'failure'/, 'the one occurrence must be the type, not a return');
  assert.ok(src.includes('rejectWorkItemSet('), 'the phase fails through rejectWorkItemSet');
});
