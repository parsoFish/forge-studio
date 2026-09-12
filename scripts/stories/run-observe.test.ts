/**
 * `collectSpendDirs` — bead `forge-rzrs`.
 *
 * WHY THIS EXISTS RATHER THAN REUSING `collectAgentRuns`. The spend total was
 * built from the REAPER's collector, whose last gate is
 * `if (pid === null && markers.length === 0) continue` (`reap.mjs:190`). That
 * gate is right for a reaper — it finds the directories it could KILL — and
 * wrong for money: a cycle's phase directory carries no `turn.pid`, so on S10
 * run 15 the project-manager's $0.6774 never reached an ENFORCED $35 ceiling.
 *
 * A dispatch that SPENT is one that wrote an event log. That is the whole
 * rule, and it is deliberately not "a dispatch we can kill".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { collectSpendDirs } from './run-observe.mjs';

function root() {
  const d = mkdtempSync(join(tmpdir(), 'spenddirs-'));
  mkdirSync(join(d, '_logs'), { recursive: true });
  return d;
}
/** A dispatch directory, optionally with an event log and a reapable pid. */
function dispatch(r: string, name: string, opts: { events?: boolean; pid?: boolean; ageMs?: number } = {}) {
  const dir = join(r, '_logs', name);
  mkdirSync(dir, { recursive: true });
  if (opts.events !== false) writeFileSync(join(dir, 'events.jsonl'), '{"event_id":"EV_1"}\n');
  if (opts.pid) writeFileSync(join(dir, 'turn.pid'), '12345\n');
  if (opts.ageMs) {
    const t = (Date.now() - opts.ageMs) / 1000;
    utimesSync(dir, t, t);
  }
  return dir;
}

describe('collectSpendDirs — a dispatch that SPENT is one that wrote an event log', () => {
  test('forge-rzrs: a cycle dir with NO turn.pid is collected — this is the $0.6774 that went missing', () => {
    const r = root();
    dispatch(r, '_architect-2026-09-12T07-21-30-e437f510', { pid: true });
    dispatch(r, '2026-09-12T07-28-42_INIT-2026-09-12-exclude-author-flag');

    const got = collectSpendDirs(r, 0).map((d) => basename(d));

    assert.equal(got.length, 2, `both dispatches must be collected — got ${JSON.stringify(got)}`);
    assert.ok(
      got.includes('2026-09-12T07-28-42_INIT-2026-09-12-exclude-author-flag'),
      'the cycle dir carries no turn.pid and is exactly what the reaper-shaped collector skipped',
    );
  });

  test('forge-rzrs: a directory with no event log is NOT collected — nothing there can have been priced', () => {
    const r = root();
    dispatch(r, '_bridge-2026-09-12T07-21-09-567-nmlci52h', { events: false });

    assert.deepEqual(collectSpendDirs(r, 0), []);
  });

  test('forge-rzrs: dispatches older than the run are NOT collected — a previous run\'s spend is not this run\'s', () => {
    const r = root();
    dispatch(r, 'old-run', { ageMs: 60 * 60 * 1000 });
    const mine = dispatch(r, 'this-run');

    const got = collectSpendDirs(r, Date.now() - 60_000);

    assert.deepEqual(got, [mine], 'only the dispatch inside this run\'s window counts');
  });

  test('forge-rzrs: a missing _logs is [] and not a throw — an absent log is UNMEASURED upstream, never a crash here', () => {
    assert.deepEqual(collectSpendDirs(mkdtempSync(join(tmpdir(), 'nologs-')), 0), []);
  });
});
