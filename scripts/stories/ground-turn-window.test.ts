/**
 * Row 195 (bead forge-8vfn.8.5.33), T1 rulings 1973gc + anchor — a Bash-born
 * ground change is attributed by the minting agent's TURN WINDOW and CWD.
 *
 * `test-fixtures/run6-s3-ground/` is copied verbatim from S3 run 6's capture
 * (`m7-e-run6-captures/S3-logs`): the four sessions' `_logs` files under
 * `logs-capture/` (ruling 85's ratchet — never a dir literally named `_logs`),
 * their mtimes (`MTIMES.txt`, re-applied below), and the run log's containment
 * lines (`run6-s3-containment.txt`). The GROUND mtimes in `MTIMES.txt` are
 * RECONSTRUCTED from the writing events — the runner tore `projects/story-s3`
 * down before any ground stat — and say so in the file.
 *
 * The measured timeline:
 *   21:17:58.335  onboarding agent's turn.pid born; 58.337 `agent-run.dispatched`
 *                 with `metadata.project: "story-s3"`
 *   21:18:34.984  Bash: `… > CHANGELOG.md && echo "0.1.0" > PROVIDER_VERSION.txt && mkdir -p docs …`
 *   21:18:47.535  Bash: `echo "0.1.0" > …/PROVIDER_VERSION.txt`
 *   21:18:48.657  Write: CHANGELOG.md — the ONLY one of the three a tool call names
 *   21:18:49.954  Bash: `mkdir -p …/docs/resources … && touc…` (truncated)
 *   21:19:02.474  `agent-dispatch.failed` (exit 143) — the session's last line
 *   21:19:18.973  `UNDECLARED A PROVIDER_VERSION.txt`, `UNDECLARED A docs/.gitkeep`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyOwnGroundDrift, groundIgnoreNoneForTests } from './ground-hash.mjs';
import { mintedSessionPaths, mintedSessionWrites } from './ground-minted.mjs';
import { groundMtimeOf, mintedSessionWindowWrites, sessionTurnWindow } from './ground-turn-window.mjs';
import { FS_CLOCK_SLACK_MS } from './beats-queue-terminal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'test-fixtures', 'run6-s3-ground');
/** The ground those logs really wrote into — the absolute path their `output_refs` carry. */
const GROUND = '/home/parso/forge-clean-m7e/projects/story-s3';
const AGENT = '_agent/onboarding-agent-2026-10-02T21-17-58-286-h1t6';
const at = (iso: string) => Date.parse(iso);

/** The five ground-proper changes S3 run 6 judged (its `_onboarding/…` files sit inside a minted dir and are not at issue). */
const RUN6_CHANGES = {
  added: ['.forge/agent-run/PROMPT.md', '.forge/contract-compliance-report.json', 'CHANGELOG.md', 'PROVIDER_VERSION.txt', 'docs/.gitkeep'],
  removed: [] as string[],
  modified: [] as string[],
};

function mtimesFile(): { logs: [string, Date][], ground: Map<string, number> } {
  const logs: [string, Date][] = [];
  const ground = new Map<string, number>();
  for (const line of readFileSync(join(FIXTURE, 'MTIMES.txt'), 'utf8').split('\n')) {
    const m = /^(\S+)\s+(_logs|ground)\/(\S+)$/.exec(line.trim());
    if (m === null) continue;
    if (m[2] === '_logs') logs.push([m[3], new Date(m[1])]);
    else ground.set(m[3], at(m[1]));
  }
  return { logs, ground };
}

function stageRun6Logs(): string {
  const root = mkdtempSync(join(tmpdir(), 'turn-window-run6-'));
  const logs = join(root, '_logs');
  cpSync(join(FIXTURE, 'logs-capture'), logs, { recursive: true });
  for (const [rel, when] of mtimesFile().logs) utimesSync(join(logs, rel), when, when);
  return logs;
}

test('row 195 fixture: the captured run log carries the red this file replays', () => {
  const log = readFileSync(join(FIXTURE, 'run6-s3-containment.txt'), 'utf8');
  assert.match(log, /own ground: UNDECLARED A PROVIDER_VERSION\.txt — nothing this run minted accounts for it/);
  assert.match(log, /own ground: UNDECLARED A docs\/\.gitkeep — nothing this run minted accounts for it/);
  assert.match(log, /own ground: PRODUCED A CHANGELOG\.md — written by _agent\/onboarding-agent-2026-10-02T21-17-58-286-h1t6/);
  assert.match(log, /S3: red — 13\/13 beats green/);
});

test('row 195 window: the captured agent is bound to the ground and its window spans turn.pid birth → its last line', () => {
  const logs = stageRun6Logs();
  try {
    const w = sessionTurnWindow(join(logs, '_agent-onboarding-agent-2026-10-02T21-17-58-286-h1t6'), GROUND);
    assert.deepEqual(w, {
      startMs: at('2026-10-02T21:17:58.335Z') - FS_CLOCK_SLACK_MS,
      endMs: at('2026-10-02T21:19:02.474Z') + FS_CLOCK_SLACK_MS,
    });
    // `_bridge` sessions carry no dispatch event — no cwd evidence, no window.
    assert.equal(sessionTurnWindow(join(logs, '_bridge-2026-10-02T21-18-30-318-oybwrf2q'), GROUND), null);
    // The same agent judged against ANOTHER ground is not bound to it.
    assert.equal(sessionTurnWindow(join(logs, '_agent-onboarding-agent-2026-10-02T21-17-58-286-h1t6'), '/x/projects/story-s2'), null);
  } finally {
    rmSync(dirname(logs), { recursive: true, force: true });
  }
});

test('row 195 DOOR, red half: S3 run 6 without the window — the two Bash-born files read UNDECLARED, as the run printed', () => {
  const logs = stageRun6Logs();
  try {
    const minted = mintedSessionPaths([], ['_agent-onboarding-agent-2026-10-02T21-17-58-286-h1t6', '_bridge-2026-10-02T21-18-30-318-oybwrf2q', '_bridge-2026-10-02T21-18-40-230-hzekbxqt'], logs);
    const { undeclared } = classifyOwnGroundDrift(RUN6_CHANGES, minted, mintedSessionWrites(minted, logs, GROUND), groundIgnoreNoneForTests());
    assert.deepEqual(undeclared, [
      'A PROVIDER_VERSION.txt — nothing this run minted accounts for it',
      'A docs/.gitkeep — nothing this run minted accounts for it',
    ]);
  } finally {
    rmSync(dirname(logs), { recursive: true, force: true });
  }
});

test('row 195 DOOR: S3 run 6 — both Bash-born files are PRODUCED by the onboarding agent; CHANGELOG.md keeps its tool attribution', () => {
  const logs = stageRun6Logs();
  try {
    const minted = mintedSessionPaths([], ['_agent-onboarding-agent-2026-10-02T21-17-58-286-h1t6', '_bridge-2026-10-02T21-18-30-318-oybwrf2q', '_bridge-2026-10-02T21-18-40-230-hzekbxqt'], logs);
    const ground = mtimesFile().ground;
    const { produced, undeclared } = classifyOwnGroundDrift(
      RUN6_CHANGES, minted, mintedSessionWrites(minted, logs, GROUND), groundIgnoreNoneForTests(), [], new Map(),
      mintedSessionWindowWrites(minted, logs, GROUND, RUN6_CHANGES, (rel: string) => ground.get(rel) ?? null),
    );
    assert.deepEqual(undeclared, [], undeclared.join(' | '));
    const bash = `written inside the turn window of ${AGENT} (cwd is this ground; no tool call names it — Bash-born)`;
    assert.ok(produced.includes(`A PROVIDER_VERSION.txt — ${bash}`), produced.join('\n'));
    assert.ok(produced.includes(`A docs/.gitkeep — ${bash}`), produced.join('\n'));
    assert.ok(produced.includes(`A CHANGELOG.md — written by ${AGENT}`), 'the tool attribution still wins and still names the session');
  } finally {
    rmSync(dirname(logs), { recursive: true, force: true });
  }
});

/** A minimal ground-bound agent session whose events span [fromIso, toIso]. */
function agentSession(logs: string, dirName: string, project: string, fromIso: string, toIso: string) {
  const dir = join(logs, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), [
    { started_at: fromIso, event_type: 'log', message: 'agent-run.dispatched', metadata: { agent_slug: 'onboarding-agent', project } },
    { started_at: toIso, event_type: 'log', message: 'agent-dispatch.failed' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function realGround(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'turn-window-unit-'));
  const ground = join(root, 'projects', 'story-unit');
  const logs = join(root, '_logs');
  mkdirSync(ground, { recursive: true });
  mkdirSync(logs);
  for (const [rel, iso] of Object.entries(files)) {
    mkdirSync(dirname(join(ground, rel)), { recursive: true });
    writeFileSync(join(ground, rel), 'x\n');
    utimesSync(join(ground, rel), new Date(iso), new Date(iso));
  }
  return { root, ground, logs };
}

test('row 195 unit: a Bash-born file whose mtime is inside the agent window is PRODUCED; one outside every window stays UNDECLARED', () => {
  const { root, ground, logs } = realGround({
    'inside.txt': '2026-10-02T10:00:30.000Z',
    'edge.txt': '2026-10-02T10:01:00.200Z', // inside only by the FS clock slack
    'after.txt': '2026-10-02T10:05:00.000Z', // after the agent's last line — nobody's
  });
  try {
    agentSession(logs, '_agent-onboarding-agent-u1', 'story-unit', '2026-10-02T10:00:00.000Z', '2026-10-02T10:01:00.000Z');
    const minted = mintedSessionPaths([], ['_agent-onboarding-agent-u1'], logs);
    const changes = { added: ['after.txt', 'edge.txt', 'inside.txt'], removed: ['gone.txt'], modified: [] as string[] };
    const { produced, undeclared } = classifyOwnGroundDrift(
      changes, minted, mintedSessionWrites(minted, logs, ground), groundIgnoreNoneForTests(), [], new Map(),
      mintedSessionWindowWrites(minted, logs, ground, changes, groundMtimeOf(ground)),
    );
    assert.deepEqual(produced.map((l) => l.split(' — ')[0]), ['A edge.txt', 'A inside.txt']);
    // Outside every window → red; a removal has no mtime to place → red.
    assert.deepEqual(undeclared, [
      'A after.txt — nothing this run minted accounts for it',
      'R gone.txt — nothing this run minted accounts for it',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 195 unit: OVERLAPPING windows attribute the path to every covering agent and name them all; another project\'s agent never', () => {
  const { root, ground, logs } = realGround({ 'shared.txt': '2026-10-02T10:00:45.000Z' });
  try {
    agentSession(logs, '_agent-a-1', 'story-unit', '2026-10-02T10:00:00.000Z', '2026-10-02T10:01:00.000Z');
    agentSession(logs, '_agent-b-2', 'story-unit', '2026-10-02T10:00:40.000Z', '2026-10-02T10:02:00.000Z');
    agentSession(logs, '_agent-c-3', 'story-elsewhere', '2026-10-02T10:00:00.000Z', '2026-10-02T10:02:00.000Z');
    const minted = mintedSessionPaths([], ['_agent-a-1', '_agent-b-2', '_agent-c-3'], logs);
    const changes = { added: ['shared.txt'], removed: [] as string[], modified: [] as string[] };
    const { produced, undeclared } = classifyOwnGroundDrift(
      changes, minted, mintedSessionWrites(minted, logs, ground), groundIgnoreNoneForTests(), [], new Map(),
      mintedSessionWindowWrites(minted, logs, ground, changes, groundMtimeOf(ground)),
    );
    assert.deepEqual(undeclared, []);
    assert.deepEqual(produced, ['A shared.txt — written inside the turn window of _agent/a-1, _agent/b-2 (cwd is this ground; no tool call names it — Bash-born)']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 195 unit: the window is the LAST resort — an ignored path inside it stays IGNORED, a declared one stays DECLARED', () => {
  const { root, ground, logs } = realGround({ '.venv/x.py': '2026-10-02T10:00:30.000Z', 'decl.md': '2026-10-02T10:00:30.000Z' });
  try {
    agentSession(logs, '_agent-a-1', 'story-unit', '2026-10-02T10:00:00.000Z', '2026-10-02T10:01:00.000Z');
    const minted = mintedSessionPaths([], ['_agent-a-1'], logs);
    const changes = { added: ['.venv/x.py', 'decl.md'], removed: [] as string[], modified: [] as string[] };
    const split = classifyOwnGroundDrift(
      changes, minted, mintedSessionWrites(minted, logs, ground),
      { isIgnored: (p: string) => p.startsWith('.venv/'), source: 'test .gitignore' },
      [{ path: 'decl.md', change: 'added' }], new Map(),
      mintedSessionWindowWrites(minted, logs, ground, changes, groundMtimeOf(ground)),
    );
    assert.deepEqual(split.produced, []);
    assert.equal(split.ignored.length, 1);
    assert.equal(split.declared.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 195: mintedSessionWindowWrites refuses without an mtimeOf — never skippable', () => {
  assert.throws(
    () => mintedSessionWindowWrites([], '/nope', '/nope', { added: [], modified: [] }, undefined as unknown as (r: string) => number | null),
    /mtimeOf .* is REQUIRED/,
  );
});
