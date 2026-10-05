/**
 * Row 206 part (a) — "NO STATE BEFORE THE CLAIM," pinned end to end against
 * a REAL bridge, for the exact route the m7-e-r206-fixgate-s1 capture caught
 * in the act: `POST /api/architect/answer` writing `answers.json` +
 * `status.json` (phase `'interviewing'`) and THEN finding the prior turn's
 * exit window still live.
 *
 * `handleArchitectRoutes` now calls `ctx.claimAgentTurnSlot` BEFORE either
 * write (packages/sessions/bridge-studio-architect.ts) — this file proves the
 * observable effect: a refused dispatch (a live, OWNED holder already
 * occupying this session's slot) leaves `answers.json`/`status.json`
 * byte-IDENTICAL and answers 409; once that holder is gone, the SAME request
 * dispatches and the files move for real.
 *
 * The pre-existing holder is a REAL child process (never a fixture claiming
 * to be "alive") carrying the session id as a whole argv element — the exact
 * ownership proof `isTurnAlive` (`@forge/sessions`) requires — so the claim
 * this test defeats is the SAME one a real turn would hold.
 *
 * REAL SPAWN for the retry, deliberately — `FORGE_ARCHITECT_NO_SPAWN` is
 * never set here. A stand-in `apps/forge/cli.ts` (mirrors
 * `bridge-agent-dispatch-one-start.test.ts`'s own stub-CLI technique) stays
 * alive so the test can confirm a genuinely NEW child was born.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import { startBridge } from '../../ui-bridge.ts';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
const savedDryBridge = process.env.FORGE_DRY_BRIDGE;
const sid = `claim-first-${Date.now()}`;
const project = 'demoproj';

function sessionDir(): string {
  return join(forgeRoot, '_logs', '_sessions', project, '_architect', sid);
}

function logDir(): string {
  return join(forgeRoot, '_logs', `_architect-${sid}`);
}

/** A minimal `apps/forge/cli.ts` stand-in that stays alive (SIGTERM-ended),
 *  writing its own argv to a fixed file so the test can confirm a real
 *  process was actually spawned — verbatim technique from
 *  `bridge-agent-dispatch-one-start.test.ts`'s own `writeStubCli`. */
function writeStubCli(root: string): void {
  mkdirSync(join(root, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(root, 'apps', 'forge', 'cli.ts'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "writeFileSync(join(import.meta.dirname, '..', '..', 'spawned.json'), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));",
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
  );
}

/** A REAL process carrying `sid` as a whole argv element — the exact
 *  ownership proof `isSessionOwnershipMark` (`@forge/sessions`) requires, so
 *  `isTurnAlive(pid, sid)` reads this as a genuinely OWNED, live holder. */
async function spawnOwnedHolder(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', sid], { stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
  if (typeof child.pid !== 'number') throw new Error('spawnOwnedHolder: no pid');
  return child.pid;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
}

async function waitForExit(pid: number, timeoutMs = 5000): Promise<void> {
  await waitFor(() => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }, timeoutMs);
}

function readTurnPid(): number {
  return Number.parseInt(readFileSync(join(logDir(), 'turn.pid'), 'utf8').trim(), 10);
}

function readIfExists(path: string): string | null {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'architect-answer-claim-first-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  writeStubCli(forgeRoot);
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;

  const dir = sessionDir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', project), { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sid,
      project,
      project_repo_path: join(forgeRoot, 'projects', project),
      phase: 'awaiting-answers',
      round: 1,
      idea: 'Add a dark-mode toggle.',
      updated_at: new Date().toISOString(),
    }),
  );
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (savedNoSpawn !== undefined) process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn; else delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  if (savedDryBridge !== undefined) process.env.FORGE_DRY_BRIDGE = savedDryBridge; else delete process.env.FORGE_DRY_BRIDGE;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function postAnswer(answers: { question: string; answer: string }[]): Promise<Response> {
  return fetch(`${url}/api/architect/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project, sessionId: sid, answers }),
  });
}

test('row 206 part (a): a live OWNED holder already occupying this session refuses the answer BEFORE any write — 409, answers.json/status.json untouched; once the holder is gone, the same request dispatches for real', async () => {
  const dir = sessionDir();
  const statusBefore = readIfExists(join(dir, 'status.json'));
  const answersBefore = readIfExists(join(dir, 'answers.json')); // null — never written yet
  assert.equal(answersBefore, null, 'fixture precondition: no answers.json yet');

  // A real, OWNED turn already sits on this session's slot (a stale rerun,
  // an earlier press — the mechanism does not care which).
  mkdirSync(logDir(), { recursive: true });
  const holderPid = await spawnOwnedHolder();
  writeFileSync(join(logDir(), 'turn.pid'), `${holderPid}\n`);

  const refused = await postAnswer([{ question: 'what should round 1 cover?', answer: 'dark mode' }]);
  const refusedText = await refused.text();
  assert.equal(refused.status, 409, refusedText);
  assert.equal(readIfExists(join(dir, 'status.json')), statusBefore, 'a refused answer must not touch status.json at all');
  assert.equal(readIfExists(join(dir, 'answers.json')), null, 'a refused answer must not create answers.json at all — no half-applied round');
  assert.equal(readTurnPid(), holderPid, 'the refused dispatch must not overwrite the live holder\'s turn.pid');

  // End the holder, then prove the SAME request now dispatches for real.
  process.kill(holderPid, 'SIGTERM');
  await waitForExit(holderPid);

  const retried = await postAnswer([{ question: 'what should round 1 cover?', answer: 'dark mode' }]);
  const retriedText = await retried.text();
  assert.equal(retried.status, 200, retriedText);
  const retriedBody = JSON.parse(retriedText) as { ok: boolean; round: number };
  assert.equal(retriedBody.round, 1, 'the retried answer must actually be recorded once the prior holder is gone');
  assert.notEqual(readIfExists(join(dir, 'answers.json')), null, 'round 1 must now be persisted');
  assert.equal(
    (JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as { phase: string }).phase,
    'interviewing',
    'the retried answer must advance the real phase',
  );

  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')));
  const newHolderPid = readTurnPid();
  assert.notEqual(newHolderPid, holderPid, 'the retried dispatch must spawn a genuinely NEW child, not the dead holder\'s stale pid');
  process.kill(newHolderPid, 'SIGTERM');
  await waitForExit(newHolderPid);
});
