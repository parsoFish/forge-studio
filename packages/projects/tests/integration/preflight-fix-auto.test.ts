import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPreflightAutoFixes } from '../../preflight-fix-auto.ts';
import { runPreflight, type ClauseResult, type ClauseId } from '../../preflight.ts';

/** A non-git typescript project with a .gitignore that lacks scratch + build globs. */
function setup(): { forgeRoot: string; projectDir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pf-auto-'));
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{"name":"demoproj"}');
  writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
  writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');
  return { forgeRoot, projectDir };
}

test('C2 + ARTIFACTS + C4 auto-fixes clear their clauses', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    const before = runPreflight(projectDir, { forgeRoot });
    const result = applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });

    assert.deepEqual(result.applied.map((a) => a.clause).sort(), ['ARTIFACTS', 'C2', 'C4']);
    for (const a of result.applied) assert.equal(a.cleared, true, `${a.clause} must clear on re-run`);

    assert.ok(existsSync(join(projectDir, 'roadmap.md')), 'roadmap.md scaffolded');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'profile.md')), 'central brain profile scaffolded');
    const gi = readFileSync(join(projectDir, '.gitignore'), 'utf8');
    assert.match(gi, /\.forge\/work-items\//, 'scratch path appended');
    assert.match(gi, /\bdist\b/, 'build glob appended');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('idempotent: once cleared, a second pass applies nothing new', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    const before = runPreflight(projectDir, { forgeRoot });
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });
    const after = runPreflight(projectDir, { forgeRoot });
    const second = applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: after.clauses });
    assert.deepEqual(second.applied, [], 'cleared clauses no longer fail → nothing to apply');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('re-applying the SAME failing clauses does not duplicate .gitignore lines', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    const before = runPreflight(projectDir, { forgeRoot });
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });
    // Re-run with the STALE failing set → fixers run again but find everything present.
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });
    const gi = readFileSync(join(projectDir, '.gitignore'), 'utf8');
    const scratchHits = gi.split('\n').filter((l) => l.trim() === '.forge/work-items/').length;
    assert.equal(scratchHits, 1, 'scratch path must appear exactly once');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('ARTIFACTS fix skips a project with an unknown language', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pf-auto-unknown-'));
  const projectDir = join(forgeRoot, 'projects', 'mystery');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');
  try {
    const synthetic: ClauseResult = { clause: 'ARTIFACTS' as ClauseId, title: 'x', hard: false, pass: false, detail: '' };
    const result = applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: [synthetic] });
    assert.deepEqual(result.applied, []);
    assert.equal(result.skipped[0].clause, 'ARTIFACTS');
    assert.match(result.skipped[0].reason, /unknown project language/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

/**
 * Bead `forge-qm4d`'s seventh writer (T1 ruling 702).
 *
 * MEASURED on S1 run 6 from a clean checkout. `forge-qm4d` took that story's
 * containment failure from NINE undeclared paths to ONE, and the survivor was:
 *
 *     own ground: UNDECLARED M .gitignore — nothing this run minted accounts for it
 *
 * written by `_logs/_preflight-fix-gitweave-C1b-…`, whose own diff names it:
 * `# forge scratch (forge preflight auto-fix)`.
 *
 * WHY qm4d COULD NOT REACH IT. The onboard scaffold emits from the list it
 * RETURNS — the paths it created — and every scaffold write site is
 * `existsSync`-guarded. gitweave already had a `.gitignore`, so the scaffold
 * skipped it and this fixer APPENDED to it instead. **A bridge write that
 * modifies an existing file cannot appear in a created-list by construction**,
 * which is why the seventh writer needed naming separately rather than falling
 * out of the sixth's fix.
 *
 * So the append emits its own `file_change`, through the same kernel sink, with
 * the op that tells a reader which of the two happened.
 */

import { readdirSync } from 'node:fs';

/** Every `file_change` the bridge logged under this forge root. */
function bridgeFileChanges(forgeRoot: string): Array<{ path: string; op: string; cause: string }> {
  const logs = join(forgeRoot, '_logs');
  if (!existsSync(logs)) return [];
  return readdirSync(logs)
    .filter((d) => d.startsWith('_bridge-'))
    .flatMap((d) => readFileSync(join(logs, d, 'events.jsonl'), 'utf8').split('\n').filter(Boolean))
    .map((l) => JSON.parse(l) as { event_type: string; metadata?: Record<string, unknown> })
    .filter((e) => e.event_type === 'file_change')
    .map((e) => ({
      path: String(e.metadata?.['path'] ?? ''),
      op: String(e.metadata?.['op'] ?? ''),
      cause: String(e.metadata?.['cause'] ?? ''),
    }));
}

test('702: appending to an EXISTING .gitignore emits a file_change with op modify', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    // The fixture's `.gitignore` already exists (`node_modules\n`), which is
    // gitweave's situation and the whole reason the created-list missed it.
    const before = runPreflight(projectDir, { forgeRoot });
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });

    const changes = bridgeFileChanges(forgeRoot);
    const gi = changes.filter((c) => c.path === join(projectDir, '.gitignore'));

    assert.ok(gi.length > 0, `the append must be attributable — got: ${JSON.stringify(changes)}`);
    assert.ok(gi.every((c) => c.op === 'modify'), `an append to an existing file is a MODIFY, not a write — got ${gi.map((c) => c.op).join(', ')}`);
    assert.ok(gi.every((c) => /preflight/i.test(c.cause)), 'and it names the fixer, because "forge wrote this" without "why" is half an answer');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('702: a .gitignore this fixer CREATES is a write, not a modify — the op is the fact', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    rmSync(join(projectDir, '.gitignore'));
    const before = runPreflight(projectDir, { forgeRoot });
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });

    const gi = bridgeFileChanges(forgeRoot).filter((c) => c.path === join(projectDir, '.gitignore'));
    assert.ok(gi.length > 0, 'still attributable when it creates');
    assert.ok(gi.some((c) => c.op === 'write'), `a file that did not exist is a WRITE — got ${gi.map((c) => c.op).join(', ')}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('702: a fixer that RUNS and finds nothing missing emits nothing — an idempotent pass is not a write', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    const before = runPreflight(projectDir, { forgeRoot });
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });
    const afterFirst = bridgeFileChanges(forgeRoot).length;
    assert.ok(afterFirst > 0, 'the first pass wrote something, or this test proves nothing');

    // The SAME (now stale) clause list, deliberately: re-running with a fresh
    // preflight would find the clauses cleared and never invoke the fixer at
    // all, so the assertion below would hold for a reason that has nothing to
    // do with the emit guard. §15.400 — the fixer has to actually RUN and find
    // nothing to do. A mutation that emits on the no-op path passes the
    // fresh-preflight version of this test and fails this one.
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });

    assert.equal(
      bridgeFileChanges(forgeRoot).length, afterFirst,
      'the fixer ran, found every entry already present, and must claim nothing — the scaffold half learned the same rule',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
