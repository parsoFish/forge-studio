/**
 * forge-6gv.13.1 (projects-42) — `GET /api/studio/projects/:id/onboarding/
 * active` trusted `status.json`'s raw `phase` verbatim. A LEAKED run (the
 * dispatch process died, but nothing ever wrote a terminal phase — no
 * `agent-dispatch.failed` marker, no `writeSessionTerminalPhase`) read
 * `phase: 'running'` forever, and `OnboardWithAgent` (forge-ui,
 * apps/studio/components/studio/project-builder/OnboardWithAgent.tsx) trusted
 * `r.phase === 'running'` at face value — a dead run displayed as live
 * indefinitely, with no way back to the honest last-run block.
 *
 * Fix: the route now ALSO derives the session's own lifecycle via the SAME
 * canonical staleness rule every other session surface already applies —
 * `deriveRowLifecycle` / `deriveSessionLifecycleFor`
 * (packages/sessions/bridge-studio-lifecycle.ts,
 * DEFAULT_STALL_CEILING_MS = 180_000ms) — and reports it as an ADDITIVE
 * `lifecycle` field. `phase` itself stays the raw status.json value,
 * unchanged (AT-pinned by the pre-existing W6-B14 rows in
 * apps/forge/tests/integration/ui-bridge-onboarding-start.test.ts).
 *
 * Two fixtures, same stale mtime, differing ONLY in pid liveness — a naive
 * "phase running + idle past ceiling => stalled" mutation (ignoring pid
 * liveness entirely, the exemption W7-FIX-A2 established for a turn tracked
 * only by turn.pid) would wrongly stall the still-alive case too; only the
 * genuinely-dead pid must read stalled.
 *
 * RUN: node --test --experimental-strip-types apps/forge/tests/regression/ui-bridge-onboarding-active-leaked-run.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

import { startBridge } from '../../ui-bridge.ts';
import { sessionLogDirName, DEFAULT_STALL_CEILING_MS } from '@forge/sessions/bridge-studio-lifecycle.ts';

const REPO_ROOT_FOR_YAML = fileURLToPath(new URL('../../../..', import.meta.url));

const DEAD_PROJECT = 'leaked-run-dead-proj';
const DEAD_SID = '2026-09-25T00-00-00-dead';
const ALIVE_PROJECT = 'leaked-run-alive-proj';
const ALIVE_SID = '2026-09-25T00-00-00-alive';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
let aliveChild: ChildProcess | null = null;

type ActiveBody = {
  ok: boolean;
  sessionId: string | null;
  runId: string | null;
  phase: string | null;
  lifecycle: { state: string } | null;
};

function writeOnboardingFixture(project: string, sid: string, staleMs: number): string {
  const sessionDir = join(forgeRoot, 'projects', project, '_onboarding', sid);
  mkdirSync(sessionDir, { recursive: true });
  const startedAt = new Date(staleMs).toISOString();
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({
    phase: 'running', project, runId: `_agent-onboarding-agent-${sid}`, startedAt,
  }, null, 2), 'utf8');
  utimesSync(join(sessionDir, 'status.json'), staleMs / 1000, staleMs / 1000);
  return sessionDir;
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'onboarding-active-leaked-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', DEAD_PROJECT), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', ALIVE_PROJECT), { recursive: true });
  // The REAL registry — the route's lifecycle derivation resolves the
  // 'onboarding' descriptor off this file (findSessionKindDescriptorSafe).
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), readFileSync(join(REPO_ROOT_FOR_YAML, 'studio', 'session-kinds.yaml'), 'utf8'));

  const staleMs = Date.now() - (DEFAULT_STALL_CEILING_MS + 5 * 60_000);

  // A genuinely dead pid: spawn a child that exits almost immediately, wait
  // for the real exit event, then write THAT (now provably dead) pid into
  // turn.pid — never a guessed-unused number.
  const deadChild = spawn(process.execPath, ['-e', '0']);
  const deadPid = await new Promise<number>((resolve, reject) => {
    deadChild.once('exit', () => resolve(deadChild.pid!));
    deadChild.once('error', reject);
  });
  writeOnboardingFixture(DEAD_PROJECT, DEAD_SID, staleMs);
  const deadLogDir = join(forgeRoot, '_logs', sessionLogDirName('onboarding', DEAD_SID));
  mkdirSync(deadLogDir, { recursive: true });
  writeFileSync(join(deadLogDir, 'turn.pid'), `${deadPid}\n`, 'utf8');
  utimesSync(join(deadLogDir, 'turn.pid'), staleMs / 1000, staleMs / 1000);

  // A genuinely LIVE dispatch-shaped child (argv carries `--session-dir
  // <…/_onboarding/<sid>>`, exactly what spawnAgentDispatch passes — the
  // SAME ownership-mark shape packages/sessions/tests/integration/
  // bridge-studio-lifecycle.test.ts's ONBOARDING_KILL_SID fixture uses),
  // same stale mtime as the dead case above.
  const aliveSessionDir = writeOnboardingFixture(ALIVE_PROJECT, ALIVE_SID, staleMs);
  aliveChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', '--', '--session-dir', aliveSessionDir], { detached: true, stdio: 'ignore' });
  aliveChild.unref();
  const aliveLogDir = join(forgeRoot, '_logs', sessionLogDirName('onboarding', ALIVE_SID));
  mkdirSync(aliveLogDir, { recursive: true });
  writeFileSync(join(aliveLogDir, 'turn.pid'), `${aliveChild.pid}\n`, 'utf8');
  utimesSync(join(aliveLogDir, 'turn.pid'), staleMs / 1000, staleMs / 1000);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (aliveChild && aliveChild.pid) { try { process.kill(aliveChild.pid, 'SIGKILL'); } catch { /* already dead */ } }
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
});

test('projects-42: GET .../onboarding/active on a LEAKED run (dead pid, status.json phase still "running" past the stall ceiling) carries an honest derived lifecycle — never a bare phase:"running" a caller could mistake for live', async () => {
  const res = await fetch(`${url}/api/studio/projects/${DEAD_PROJECT}/onboarding/active`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as ActiveBody;
  assert.equal(body.ok, true);
  assert.equal(body.sessionId, DEAD_SID);
  // The raw session phase IS still 'running' — status.json's own literal
  // field, unchanged by this fix; it is exactly this raw value
  // `OnboardWithAgent` used to trust at face value.
  assert.equal(body.phase, 'running');
  assert.ok(body.lifecycle, `expected the route to carry a derived "lifecycle" alongside the raw phase; got ${text}`);
  assert.equal(
    body.lifecycle!.state, 'stalled',
    `a dead turn.pid past DEFAULT_STALL_CEILING_MS (${DEFAULT_STALL_CEILING_MS}ms) must derive "stalled" — the SAME canonical rule every other session surface already applies; got ${JSON.stringify(body.lifecycle)}`,
  );
});

test('projects-42 (no false positives): GET .../onboarding/active for a run whose turn is STILL genuinely alive (same stale mtime, live tracked pid) keeps reading a live lifecycle — the ceiling alone must never stall a turn that has nothing to be silent on (turn.pid-only exemption)', async () => {
  const res = await fetch(`${url}/api/studio/projects/${ALIVE_PROJECT}/onboarding/active`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as ActiveBody;
  assert.equal(body.ok, true);
  assert.equal(body.sessionId, ALIVE_SID);
  assert.equal(body.phase, 'running');
  assert.ok(body.lifecycle, `expected a derived "lifecycle"; got ${text}`);
  assert.equal(body.lifecycle!.state, 'working', `a live tracked turn with no liveness channel must read "working", never "stalled"; got ${JSON.stringify(body.lifecycle)}`);
});
