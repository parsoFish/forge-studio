/**
 * Row 190 (bead `forge-8vfn.8.5.28`, T1 ruling 1973en) — the demo builder may
 * write `.forge/demo/` only, and a Bash write is how it did not.
 *
 * WHAT WAS MEASURED. A costed S1 story run (capture
 * `_1.0/evidence/m7-e-r8-s1-capture/`): beat 8's demo-builder session, phase
 * `generating`, in its grounding pass — the one pass that holds Bash — ran
 * `python3 -c "…open('schemas/overlay.schema.json')…json.dump…"` (16:12:20),
 * `cp /tmp/overlay.schema.json.bak …/schemas/overlay.schema.json` (16:12:31)
 * and `python3 -c "…del schema[…]…"` (16:12:55): it edited the PROJECT's own
 * schema to stage a before/after, and left it edited. The turn ended
 * `awaiting-review` (16:14:06), the demo LOCKED on the mutated ground
 * (16:14:07), and only the story harness's own-ground sweep caught it
 * (run.log:4616 `UNDECLARED M schemas/overlay.schema.json`, :4639 CONTAINMENT
 * FAILURE). Passes 1 and 2 are tool-fenced; pass 3 cannot be — a demo that
 * cannot run the project cannot show real output — and a Bash write is
 * invisible to the write-root fence (`session-write-fence.ts`).
 *
 * THE LEVER is the ground itself: snapshot it before the turn, diff it after
 * each agent pass, and fail the turn naming every path changed outside
 * `.forge/demo/` (and the session's own dir) — never lock on a mutated ground.
 *
 * The fake SDK below reproduces the capture's three Bash effects on a tmp git
 * project whose session dir lives INSIDE the repo, as `ground-clear/_demo/`
 * shows the real one did.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel';

import { DRIVABLE_DECLARATION, logger } from './test-fixtures/demo-builder-runner-fixtures.ts';
import { runDemoBuilderTurn, demoSessionDir } from '../../kinds/demo-builder.ts';
import { DEMO_DECLARATION_REL_PATH, DEMO_HTML_REL_PATH, type DemoBuilderStatus } from '../../kinds/demo-session-store.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';

const SCHEMA_REL = 'schemas/overlay.schema.json';
const SCHEMA = {
  properties: { spec: { properties: { environments: { additionalProperties: {
    properties: { variables: { type: 'object' }, reviewers: { type: 'array' } },
  } } } } },
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

/** A committed git project that is ALSO the projects root: `_demo/<sid>/`
 *  lands inside the repo, untracked, exactly as the S1 ground held it. */
function setupGround(): { repoPath: string; logsRoot: string; sessionId: string } {
  const root = mkdtempSync(join(tmpdir(), 'demo-ground-fence-'));
  const repoPath = join(root, 'story-s1');
  mkdirSync(join(repoPath, '.forge'), { recursive: true });
  mkdirSync(join(repoPath, 'schemas'), { recursive: true });
  writeFileSync(join(repoPath, '.forge', 'project.json'), JSON.stringify({ demoProcess: DRIVABLE_DECLARATION }));
  writeFileSync(join(repoPath, SCHEMA_REL), `${JSON.stringify(SCHEMA, null, 2)}\n`);
  git(repoPath, 'init', '-q', '-b', 'main');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-q', '-m', 'ground');
  const sessionId = '2026-10-02T16-06-29-a9be4882';
  const sessionDir = demoSessionDir(repoPath, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: sessionId, project: 'story-s1', project_repo_path: repoPath,
    phase: 'generating', iteration: 1, prompt: 'Show the scan and its summary.',
    updated_at: new Date().toISOString(),
  };
  writeSessionStatus(sessionDir, status);
  return { repoPath, logsRoot: join(root, '_logs'), sessionId };
}

/** Pass 2 writes the two deliverables; pass 3 (the Bash-holding grounding
 *  pass) runs `ground`, standing in for whatever its Bash calls did. */
function groundingQueryFn(ground: (cwd: string) => void): QueryFn {
  let n = 0;
  return ({ options }) => {
    n += 1;
    const pass = n;
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      if (pass === 2) {
        writeFileSync(join(cwd, DEMO_DECLARATION_REL_PATH), JSON.stringify(DRIVABLE_DECLARATION));
        writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      }
      if (pass === 3) ground(cwd);
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
}

/** The capture's three Bash effects, 16:12:20 → 16:12:55, in order. */
function capturedSchemaEdit(cwd: string): void {
  const path = join(cwd, SCHEMA_REL);
  const backup = join(cwd, '..', 'overlay.schema.json.bak');
  const schema = JSON.parse(readFileSync(path, 'utf8')) as typeof SCHEMA;
  writeFileSync(backup, JSON.stringify(schema, null, 2));
  const stripped = structuredClone(schema) as { properties: { spec: { properties: { environments: { additionalProperties: { properties: Record<string, unknown> } } } } } };
  delete stripped.properties.spec.properties.environments.additionalProperties.properties.variables;
  writeFileSync(path, JSON.stringify(stripped, null, 2));
  copyFileSync(backup, path); // `cp /tmp/overlay.schema.json.bak …` — json.dump's bytes, not the original's
  writeFileSync(path, JSON.stringify(stripped, null, 2)); // the second `del schema[…]`, never restored
}

const events = (logsRoot: string, sid: string): Array<{ event_type: string; message: string; metadata?: Record<string, unknown> }> =>
  readFileSync(join(logsRoot, `_demo-${sid}`, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('row 190: a grounding pass that edits the project source FAILS the turn naming the path — the demo never reaches awaiting-review', async () => {
  const { repoPath, logsRoot, sessionId } = setupGround();
  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId, projectRoot: repoPath, forgeRoot: FORGE_ROOT, logsRoot,
      queryFn: groundingQueryFn(capturedSchemaEdit), logger: logger(logsRoot, sessionId),
    }),
    (err: Error) => {
      assert.match(err.message, /schemas\/overlay\.schema\.json/, 'the failure names the mutated path');
      return true;
    },
  );
  const fenced = events(logsRoot, sessionId).find((e) => e.event_type === 'error' && /ground/.test(e.message));
  assert.ok(fenced, 'a structured error event records the breach');
  // Exactly the schema: the deliverables under `.forge/demo/` and the untracked
  // `_demo/<sid>/` session dir inside the repo are the demo's own, not breaches.
  assert.deepEqual(fenced.metadata?.paths, [SCHEMA_REL]);
  assert.notEqual(events(logsRoot, sessionId).at(-1)?.message, 'demo-generated', 'no generation was recorded');
  // Named and failed, NOT reverted (ruling 1973en): the operator sees the edit.
  assert.match(git(repoPath, 'status', '--porcelain'), / M schemas\/overlay\.schema\.json/);
});

test('row 190: a grounding pass that writes only under .forge/demo/ passes — editing its own sample is the pass\'s job', async () => {
  const { repoPath, logsRoot, sessionId } = setupGround();
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot: repoPath, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: groundingQueryFn((cwd) => writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>grounded: 141 passed</body></html>')),
    logger: logger(logsRoot, sessionId),
  });
  assert.equal(result.phase, 'awaiting-review');
});

test('row 190: a ground already dirty BEFORE the turn is the baseline — only changes made during it count', async () => {
  const { repoPath, logsRoot, sessionId } = setupGround();
  writeFileSync(join(repoPath, SCHEMA_REL), '{"operator": "work in progress"}\n');
  writeFileSync(join(repoPath, 'NOTES.md'), 'untracked operator notes\n');
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot: repoPath, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: groundingQueryFn(() => {}), logger: logger(logsRoot, sessionId),
  });
  assert.equal(result.phase, 'awaiting-review', 'pre-existing dirt is not the agent\'s');
});

test('row 190: a further edit to an ALREADY-dirty file is still caught — the baseline stamps content, not just porcelain status', async () => {
  const { repoPath, logsRoot, sessionId } = setupGround();
  writeFileSync(join(repoPath, SCHEMA_REL), '{"operator": "work in progress"}\n');
  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId, projectRoot: repoPath, forgeRoot: FORGE_ROOT, logsRoot,
      queryFn: groundingQueryFn((cwd) => writeFileSync(join(cwd, SCHEMA_REL), '{"operator": "work in progress", "agent": "too"}\n')),
      logger: logger(logsRoot, sessionId),
    }),
    /schemas\/overlay\.schema\.json/,
  );
});

test('row 190b: a ground COMMIT does not red this fence — HEAD is the host fence\'s (row 188), a ground\'s own commits are the product\'s (T1 ruling 1973fa)', async () => {
  // Was row 190's "a grounding pass that COMMITS its edit is caught too —
  // HEAD is part of the ground". r9 measured that HEAD stamp false-redding on
  // a commit ANOTHER forge actor made mid-pass (the 190b test below), and
  // ruling 1973fa dropped HEAD from this fence. The trade is recorded, not
  // hidden: an edit the pass commits leaves no porcelain entry, so this fence
  // no longer names it.
  const { repoPath, logsRoot, sessionId } = setupGround();
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot: repoPath, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: groundingQueryFn((cwd) => { capturedSchemaEdit(cwd); git(cwd, 'commit', '-q', '-am', 'tweak'); }),
    logger: logger(logsRoot, sessionId),
  });
  assert.equal(result.phase, 'awaiting-review');
});

/**
 * Row 190b (bead `forge-8vfn.8.5.31`, T1 ruling 1973fa) — the r9 false red.
 * Capture `_1.0/evidence/m7-e-r9-s1-capture/`: the demo session's `error`
 * event at 17:50:48.889Z named `.forge/contract-compliance-report.json`,
 * `HEAD (commit)` and `_onboarding/2026-10-02T17-42-10-91476d29/status.json`.
 * MTIMES.txt puts the onboarding session's finish at 17:50:42.866–.869Z —
 * INSIDE the demo's ground pass (session born 17:47:33.649Z): the onboarding
 * agent wrote its status, its compliance report and its commit between this
 * fence's snapshot and its check. Forge's own actors, not project source.
 */
const R9_ONBOARDING_STATUS = '_onboarding/2026-10-02T17-42-10-91476d29/status.json';
const R9_COMPLIANCE = '.forge/contract-compliance-report.json';

test('row 190b: forge\'s own actors writing the ground mid-pass (the r9 capture) do NOT red the fence', async () => {
  const { repoPath, logsRoot, sessionId } = setupGround();
  // Before the demo turn: the onboarding session (born 17:42:10) already holds its dir.
  mkdirSync(join(repoPath, '_onboarding', '2026-10-02T17-42-10-91476d29'), { recursive: true });
  writeFileSync(join(repoPath, R9_ONBOARDING_STATUS), '{"phase":"running"}\n');
  writeFileSync(join(repoPath, R9_COMPLIANCE), '{"ok":false}\n');
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot: repoPath, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: groundingQueryFn(() => {
      // 17:50:42 — the onboarding session finishes while the demo grounds.
      writeFileSync(join(repoPath, R9_ONBOARDING_STATUS), '{"phase":"done"}\n');
      writeFileSync(join(repoPath, R9_COMPLIANCE), '{"ok":true}\n');
      writeFileSync(join(repoPath, 'AGENTS.md'), '# story-s1\n');
      git(repoPath, 'add', 'AGENTS.md');
      git(repoPath, 'commit', '-q', '-m', 'chore: onboard');
    }),
    logger: logger(logsRoot, sessionId),
  });
  assert.equal(result.phase, 'awaiting-review');
  assert.ok(!events(logsRoot, sessionId).some((e) => e.metadata?.rule === 'demo-ground-fence'), 'no ground-fence error event');
});

test('row 190b: forge-owned writes beside a real source edit — the fence names ONLY the source path', async () => {
  const { repoPath, logsRoot, sessionId } = setupGround();
  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId, projectRoot: repoPath, forgeRoot: FORGE_ROOT, logsRoot,
      queryFn: groundingQueryFn((cwd) => {
        mkdirSync(join(repoPath, '_onboarding', '2026-10-02T17-42-10-91476d29'), { recursive: true });
        writeFileSync(join(repoPath, R9_ONBOARDING_STATUS), '{"phase":"done"}\n');
        writeFileSync(join(repoPath, R9_COMPLIANCE), '{"ok":true}\n');
        capturedSchemaEdit(cwd);
      }),
      logger: logger(logsRoot, sessionId),
    }),
    /schemas\/overlay\.schema\.json/,
  );
  const fenced = events(logsRoot, sessionId).find((e) => e.metadata?.rule === 'demo-ground-fence');
  assert.deepEqual(fenced?.metadata?.paths, [SCHEMA_REL]);
});
