/**
 * Tests for forge-ui/lib/connection-library-view.ts (R3-04-F2/F3) — DOES NOT
 * EXIST YET. Vitest cannot even collect this file until it lands
 * (module-not-found is the expected red).
 *
 * Pure view-state derivation for the `/connections` library page + detail
 * page, mirroring hook-library-view.ts's testability convention: no DOM, no
 * React, no network. Types come from `./connection-client.ts` — this module
 * assumes a parsed, already-trustworthy `ConnectionWire` and never
 * re-derives probe state / capabilities-curation itself.
 *
 * `readinessCounts` feeds the agent-builder `[data-ready-count]` panel (F3
 * AC: "readiness panel counts reflect probe reality"). `blockedRunMessage`
 * is the pure string-builder behind the blocked-Run control's copy (F3 AC:
 * "blocks run with an actionable … message" that "NAMES the unready
 * component(s) and their state" — D9's literal wording, "Agent not ready"
 * alone is a documented failure of this AC).
 *
 * `describeInstallOutcome` (T2 ruling round 2, item 3c) renders the bridge's
 * `POST .../install` response — its ONE non-negotiable job is that a
 * SUPPRESSED result (`{ok:true, suppressed:true, wouldInstall}`) never reads
 * as success/installed. A demo that renders a suppressed install as
 * "installed" is fabricated coverage — exactly the defect class this
 * campaign exists to prevent.
 */
import { test, expect } from 'vitest';
import { filterConnections, readinessCounts, connectionBadges, blockedRunMessage, describeInstallOutcome } from './connection-library-view.ts';
import type { ConnectionWire } from './connection-client.ts';

function mk(overrides: Partial<ConnectionWire> = {}): ConnectionWire {
  return {
    id: 'git',
    name: 'git',
    desc: 'Worktrees, branches, commits.',
    kind: 'tool',
    installable: false,
    install: { method: 'system-provided' },
    config: [],
    probe: { state: 'available' },
    provenance: 'system',
    usedBy: [],
    usedByDerivation: { source: 'x', scanned: 0 },
    ...overrides,
  } as ConnectionWire;
}

// ---------------------------------------------------------------------------
// filterConnections
// ---------------------------------------------------------------------------

test('filterConnections: empty query returns a NEW array of every entry, unfiltered', () => {
  const entries = [mk({ id: 'git' }), mk({ id: 'sqlite', kind: 'mcp' })];
  const result = filterConnections(entries, '');
  expect(result).toEqual(entries);
  expect(result).not.toBe(entries);
});

test('filterConnections: matches on name (case-insensitive) or description', () => {
  const entries = [
    mk({ id: 'git', name: 'git', desc: 'Worktrees, branches, commits.' }),
    mk({ id: 'sqlite', kind: 'mcp', name: 'SQLite', desc: 'Query a local database.' }),
  ];
  expect(filterConnections(entries, 'SQL').map((e) => e.id)).toEqual(['sqlite']);
  expect(filterConnections(entries, 'worktrees').map((e) => e.id)).toEqual(['git']);
  expect(filterConnections(entries, 'no-match-anywhere')).toEqual([]);
});

// ---------------------------------------------------------------------------
// readinessCounts — feeds [data-ready-count] (F3 AC)
// ---------------------------------------------------------------------------

test('readinessCounts: tallies available/not-installed/misconfigured + total from REAL probe.state, never a declared field', () => {
  const entries = [
    mk({ id: 'a', probe: { state: 'available' } }),
    mk({ id: 'b', probe: { state: 'available' } }),
    mk({ id: 'c', probe: { state: 'not-installed' } }),
    mk({ id: 'd', probe: { state: 'misconfigured' } }),
  ];
  expect(readinessCounts(entries)).toEqual({ available: 2, notInstalled: 1, misconfigured: 1, total: 4 });
});

test('readinessCounts: an empty entry list → all-zero counts, never undefined', () => {
  expect(readinessCounts([])).toEqual({ available: 0, notInstalled: 0, misconfigured: 0, total: 0 });
});

// ---------------------------------------------------------------------------
// connectionBadges — derived from real fields only
// ---------------------------------------------------------------------------

test('connectionBadges: an available connection carries no state badge', () => {
  expect(connectionBadges(mk({ probe: { state: 'available' } }))).toEqual([]);
});

test('connectionBadges: not-installed / misconfigured surface as distinct badges', () => {
  expect(connectionBadges(mk({ probe: { state: 'not-installed' } }))).toContain('not-installed');
  expect(connectionBadges(mk({ probe: { state: 'misconfigured' } }))).toContain('misconfigured');
});

test('connectionBadges: an mcp entry whose capabilities are curated carries a "curated" badge; a tool entry never does', () => {
  const mcp = mk({ id: 'sqlite', kind: 'mcp', capabilities: [{ name: 'query', summary: 'x' }], capabilitiesSource: 'curated' });
  const tool = mk({ id: 'git', kind: 'tool' });
  expect(connectionBadges(mcp)).toContain('curated');
  expect(connectionBadges(tool)).not.toContain('curated');
});

// ---------------------------------------------------------------------------
// blockedRunMessage — the F3/D9 blocked-Run copy: MUST name the component(s)
// and their state(s). "Agent not ready" alone is a documented failure of
// this AC.
// ---------------------------------------------------------------------------

test('blockedRunMessage: names a single unready component and its state', () => {
  const msg = blockedRunMessage([{ id: 'sqlite', kind: 'mcp', state: 'not-installed' }]);
  expect(msg).toContain('sqlite');
  expect(msg).toContain('not-installed');
});

test('blockedRunMessage: names EVERY unready component when there are several, not just the first', () => {
  const msg = blockedRunMessage([
    { id: 'sqlite', kind: 'mcp', state: 'not-installed' },
    { id: 'github', kind: 'mcp', state: 'misconfigured' },
  ]);
  expect(msg).toContain('sqlite');
  expect(msg).toContain('github');
  expect(msg).toContain('not-installed');
  expect(msg).toContain('misconfigured');
});

test('blockedRunMessage: an empty unready list produces an empty string — the caller decides whether to render a blocked control at all', () => {
  expect(blockedRunMessage([])).toBe('');
});

// ---------------------------------------------------------------------------
// describeInstallOutcome — T2 ruling round 2, item 3c: a SUPPRESSED install
// result must NEVER be presented as success/installed. This is the one
// property every test below exists to pin.
// ---------------------------------------------------------------------------

test('describeInstallOutcome: a suppressed result never reads as "installed" — the status is a distinct label naming the suppression', () => {
  const view = describeInstallOutcome({ ok: true, suppressed: true, wouldInstall: { command: 'npm', args: ['install', '--save-exact', '@x/y@1.0.0'] } });
  expect(view.status).not.toBe('installed');
  expect(view.status).not.toBe('success');
  expect(view.label.toLowerCase()).not.toContain('installed successfully');
});

test('describeInstallOutcome: a suppressed result surfaces the wouldInstall argv so the operator can see what WOULD have run', () => {
  const view = describeInstallOutcome({ ok: true, suppressed: true, wouldInstall: { command: 'npm', args: ['install', '--save-exact', '@x/y@1.0.0'] } });
  expect(view.wouldInstall).toEqual({ command: 'npm', args: ['install', '--save-exact', '@x/y@1.0.0'] });
});

test('describeInstallOutcome: a REAL (non-suppressed) successful install reads as installed — the two cases must be visibly distinct', () => {
  const real = describeInstallOutcome({ ok: true, suppressed: false });
  const suppressed = describeInstallOutcome({ ok: true, suppressed: true, wouldInstall: { command: 'npm', args: [] } });
  expect(real.status).toBe('installed');
  expect(real.status).not.toBe(suppressed.status);
});

test('describeInstallOutcome: a failed install (ok:false) reads as failed, never as installed', () => {
  const view = describeInstallOutcome({ ok: false, suppressed: false, error: 'exit code 1' });
  expect(view.status).toBe('failed');
  expect(view.status).not.toBe('installed');
});
