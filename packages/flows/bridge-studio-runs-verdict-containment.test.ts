/**
 * ACCEPTANCE TESTS (SEC-02 round 2, must be RED until fixed) — two gaps the
 * round-1 fix did NOT close in `applyReviewVerdict`
 * (`cli/bridge-studio-runs.ts`, reached by `POST /api/verdict`). Both were
 * live-proven by hand before this file was written:
 *
 *   Finding 1 (guard-symmetry hole): the APPROVE branch never containment-
 *   checks `project_repo_path` before feeding it to `ctx.runReleaseFinalize`
 *   -> `loadProjectConfig(projectRepoPath)` — even though this same round's
 *   diff added `isContainedProjectRepoPath` to the SEND-BACK branch for the
 *   identical sink (bridge-studio-runs.ts ~L355-361). Confirmed live: an
 *   approve carrying an out-of-root `project_repo_path` returns 200 and the
 *   stub `runReleaseFinalize` IS invoked (once, with the poisoned path).
 *
 *   Finding 2 (headline): `cycle_id` is completely unchecked in BOTH
 *   branches — no import of `isSafeCycleId` exists anywhere in
 *   `cli/bridge-studio-runs.ts`. `writeVerdictJson`
 *   (`orchestrator/flow-artifacts.ts:170`) and `createLogger`
 *   (`orchestrator/logging.ts:124`) both do `resolve(logsRoot, cycleId)` +
 *   `mkdirSync(recursive:true)` + a write. Confirmed live (manual repro
 *   before this file was written): `cycle_id: '../../sec02-r2-escape-<random>'`
 *   on BOTH a legitimate approve and a legitimate send-back actually created
 *   a real `artifacts/verdict.json` (send-back also `events.jsonl`) OUTSIDE
 *   both `logsRoot` and `forgeRoot`.
 *
 * Threat model: `applyReviewVerdict` reads the manifest from disk
 * (`_queue/in-flight/<id>.md` or `ready-for-review/`), NOT from an ingest
 * body — so every fixture here is planted DIRECTLY with `writeFileSync`,
 * the same defence-in-depth argument `cli/forge-requeue-containment.test.ts`
 * already makes for `runRequeue` (a different destructive call site, same
 * manifest-poisoning threat model).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../apps/forge/ui-bridge.ts';

/** Builds manifest markdown frontmatter; every string value goes through
 *  `JSON.stringify` (a valid YAML double-quoted scalar) so an attacker-
 *  shaped value (literal ".." segments) round-trips exactly as written. */
function manifestMd(overrides: Record<string, unknown>): string {
  const id = overrides.initiative_id as string;
  const data: Record<string, unknown> = {
    initiative_id: id,
    project: 'test-project',
    created_at: '2026-01-01T00:00:00.000Z',
    iteration_budget: 5,
    cost_budget_usd: 2.0,
    ...overrides,
  };
  const yamlLines = Object.entries(data).map(
    ([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`,
  );
  return ['---', ...yamlLines, '---', '', `# ${id}`, ''].join('\n');
}

function setupForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-verdict-containment-'));
  for (const s of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', s), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  // BOTH containment roots must exist, not just `projects/`. A containment
  // root that is missing fails CLOSED, so a fixture without `_worktrees/`
  // makes even a legitimate, identity-bound `<forgeRoot>/_worktrees/<id>`
  // report "outside allowed root" — which would mask the round-5 fix's real
  // invariant (a contained-but-cleaned-up worktree keeps its ordinary "gone"
  // message). A real forge always has both: `orchestrator/init.ts` `layoutDirs`
  // and the daemon's own `ensureLayout` each create them.
  mkdirSync(join(forgeRoot, '_worktrees'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  return forgeRoot;
}

async function postVerdict(url: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}/api/verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Finding 1: approve branch never containment-checks project_repo_path.
// ---------------------------------------------------------------------------

test('(RED) [Finding 1] approve with project_repo_path OUTSIDE <forgeRoot>/projects: the handler must REFUSE, and runReleaseFinalize must NEVER be invoked', async () => {
  const forgeRoot = setupForgeRoot();
  const outsideRepo = mkdtempSync(join(tmpdir(), 'finding1-outside-repo-'));
  try {
    const id = 'INIT-2026-01-01-finding1-escape';
    const wt = join(forgeRoot, '_worktrees', id); // legitimate, identity-bound worktree — isolates the escape to project_repo_path only
    mkdirSync(wt, { recursive: true });

    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${id}.md`),
      manifestMd({ initiative_id: id, project_repo_path: outsideRepo, worktree_path: wt }),
    );

    const calls: unknown[] = [];
    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => true,
      finalizeAfterMerge: async () => {},
      runReleaseFinalize: async (input) => { calls.push(input); return { release_status: 'skipped' }; },
    });
    try {
      const { status, json } = await postVerdict(url, { initiativeId: id, kind: 'approve', rationale: 'x' });
      assert.equal(
        status,
        409,
        `expected the handler to refuse an out-of-root project_repo_path (matching the existing "outside allowed root" 409 shape the send-back branch already uses for this identical sink) — got ${status}: ${JSON.stringify(json)}`,
      );
      // The pin: a status-code-only assertion would not prove the sink was
      // never reached — assert directly on the stub's call record.
      assert.equal(
        calls.length,
        0,
        `runReleaseFinalize must NEVER be invoked for an out-of-root project_repo_path — got ${calls.length} call(s): ${JSON.stringify(calls)}`,
      );
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outsideRepo, { recursive: true, force: true });
  }
});

test('non-regression [Finding 1]: approve with a LEGITIMATE project_repo_path still 200s and DOES invoke runReleaseFinalize once with the real path', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const id = 'INIT-2026-01-01-finding1-legit';
    const repo = join(forgeRoot, 'projects', 'test-project');
    mkdirSync(repo, { recursive: true });
    const wt = join(forgeRoot, '_worktrees', id);
    mkdirSync(wt, { recursive: true });

    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${id}.md`),
      manifestMd({ initiative_id: id, project_repo_path: repo, worktree_path: wt }),
    );

    const calls: Array<{ projectRepoPath: string }> = [];
    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => true,
      finalizeAfterMerge: async () => {},
      runReleaseFinalize: async (input) => { calls.push(input as { projectRepoPath: string }); return { release_status: 'skipped' }; },
    });
    try {
      const { status, json } = await postVerdict(url, { initiativeId: id, kind: 'approve', rationale: 'x' });
      assert.equal(status, 200, `expected a legitimate approve to succeed — got ${status}: ${JSON.stringify(json)}`);
      assert.equal(calls.length, 1, `expected runReleaseFinalize to be invoked exactly once — got ${calls.length}`);
      assert.equal(calls[0].projectRepoPath, repo, 'expected the real, contained project_repo_path to be threaded through unchanged');
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Finding 2 (headline): cycle_id is completely unchecked in BOTH branches.
// ---------------------------------------------------------------------------

test('(RED) [Finding 2, headline] approve with a traversing cycle_id: no file or directory may be created outside <forgeRoot>/_logs', async () => {
  const forgeRoot = setupForgeRoot();
  // Unique random suffix so a stale artifact from another run cannot make
  // this test pass by accident.
  const uniqueSuffix = `sec02-r2-escape-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cycleId = `../../${uniqueSuffix}`;
  const logsRoot = join(forgeRoot, '_logs');
  // The SAME construction the vulnerable sinks use (`resolve(logsRoot, cycleId)`
  // in writeVerdictJson/createLogger) — used only to compute WHERE the escape
  // artifact would land if the write succeeds; not a test of the fix's logic.
  const escapeTarget = resolve(logsRoot, cycleId);
  assert.ok(!escapeTarget.startsWith(forgeRoot), 'sanity: the escape target must be genuinely outside forgeRoot');

  try {
    const id = 'INIT-2026-01-01-finding2-approve';
    const repo = join(forgeRoot, 'projects', 'test-project'); // legitimate — isolates the escape to cycle_id only
    mkdirSync(repo, { recursive: true });
    const wt = join(forgeRoot, '_worktrees', id);
    mkdirSync(wt, { recursive: true });

    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${id}.md`),
      manifestMd({ initiative_id: id, cycle_id: cycleId, project_repo_path: repo, worktree_path: wt }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => true,
      finalizeAfterMerge: async () => {},
      runReleaseFinalize: async () => ({ release_status: 'skipped' }),
    });
    try {
      const { status, json } = await postVerdict(url, { initiativeId: id, kind: 'approve', rationale: 'x' });

      // PRIMARY assertion — the sentinel shape, not a status-code check.
      assert.equal(
        existsSync(escapeTarget),
        false,
        `no directory may be created OUTSIDE <forgeRoot>/_logs for a traversing cycle_id — got status ${status}: ${JSON.stringify(json)}. escapeTarget=${escapeTarget}`,
      );
      assert.equal(
        existsSync(join(escapeTarget, 'artifacts', 'verdict.json')),
        false,
        `no verdict.json may be written OUTSIDE <forgeRoot>/_logs — escapeTarget=${escapeTarget}`,
      );

      // SECONDARY: the handler should not report success for a rejected cycle_id.
      assert.notEqual(status, 200, `expected the handler to refuse a traversing cycle_id — got 200: ${JSON.stringify(json)}`);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(escapeTarget, { recursive: true, force: true });
  }
});

test('(RED) [Finding 2, headline] send-back with a traversing cycle_id: no file or directory may be created outside <forgeRoot>/_logs', async () => {
  const forgeRoot = setupForgeRoot();
  const uniqueSuffix = `sec02-r2-sb-escape-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cycleId = `../../${uniqueSuffix}`;
  const logsRoot = join(forgeRoot, '_logs');
  const escapeTarget = resolve(logsRoot, cycleId);
  assert.ok(!escapeTarget.startsWith(forgeRoot), 'sanity: the escape target must be genuinely outside forgeRoot');

  try {
    const id = 'INIT-2026-01-01-finding2-sendback';
    const repo = join(forgeRoot, 'projects', 'test-project');
    mkdirSync(repo, { recursive: true });
    const wt = join(forgeRoot, 'projects', 'test-project', 'worktrees', 'sb'); // in-place worktree shape, contained under projects/
    mkdirSync(wt, { recursive: true });

    writeFileSync(
      join(forgeRoot, '_queue', 'ready-for-review', `${id}.md`),
      manifestMd({ initiative_id: id, cycle_id: cycleId, project_repo_path: repo, worktree_path: wt }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
      finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
    });
    try {
      const { status, json } = await postVerdict(url, {
        initiativeId: id,
        kind: 'send-back',
        rationale: 'x',
        acceptanceCriteria: [{ given: 'a', when: 'b', then: 'c' }],
      });

      assert.equal(
        existsSync(escapeTarget),
        false,
        `no directory may be created OUTSIDE <forgeRoot>/_logs for a traversing cycle_id — got status ${status}: ${JSON.stringify(json)}. escapeTarget=${escapeTarget}`,
      );
      assert.equal(
        existsSync(join(escapeTarget, 'artifacts', 'verdict.json')),
        false,
        `no verdict.json may be written OUTSIDE <forgeRoot>/_logs — escapeTarget=${escapeTarget}`,
      );
      assert.equal(
        existsSync(join(escapeTarget, 'events.jsonl')),
        false,
        `no events.jsonl may be written OUTSIDE <forgeRoot>/_logs (createLogger's own resolve(logsRoot, cycleId)) — escapeTarget=${escapeTarget}`,
      );
      assert.notEqual(status, 200, `expected the handler to refuse a traversing cycle_id — got 200: ${JSON.stringify(json)}`);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(escapeTarget, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// MANDATORY positive controls: a legitimate cycle_id must still work end to
// end — without these the suite would pass against a guard that rejects
// everything, which is not a guard.
// ---------------------------------------------------------------------------

test('non-regression [Finding 2]: approve with a LEGITIMATE cycle_id still writes verdict.json under <forgeRoot>/_logs/<cycleId>/ and 200s', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const id = 'INIT-2026-01-01-finding2-approve-legit';
    const cycleId = '2026-08-06T00-00-00_INIT-2026-08-06-x';
    const repo = join(forgeRoot, 'projects', 'test-project');
    mkdirSync(repo, { recursive: true });
    const wt = join(forgeRoot, '_worktrees', id);
    mkdirSync(wt, { recursive: true });

    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${id}.md`),
      manifestMd({ initiative_id: id, cycle_id: cycleId, project_repo_path: repo, worktree_path: wt }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => true,
      finalizeAfterMerge: async () => {},
      runReleaseFinalize: async () => ({ release_status: 'skipped' }),
    });
    try {
      const { status, json } = await postVerdict(url, { initiativeId: id, kind: 'approve', rationale: 'x' });
      assert.equal(status, 200, `expected a legitimate approve to succeed — got ${status}: ${JSON.stringify(json)}`);
      const verdictPath = join(forgeRoot, '_logs', cycleId, 'artifacts', 'verdict.json');
      assert.ok(existsSync(verdictPath), `expected verdict.json under the real cycleId dir — missing at ${verdictPath}`);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('non-regression [Finding 2]: send-back with a LEGITIMATE cycle_id still writes verdict.json + events.jsonl under <forgeRoot>/_logs/<cycleId>/, and the verdict still applies', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const id = 'INIT-2026-01-01-finding2-sendback-legit';
    const cycleId = '2026-08-06T00-00-01_INIT-2026-08-06-y';
    const repo = join(forgeRoot, 'projects', 'test-project');
    mkdirSync(repo, { recursive: true });
    const wt = join(forgeRoot, 'projects', 'test-project', 'worktrees', 'sb-legit');
    mkdirSync(wt, { recursive: true });

    writeFileSync(
      join(forgeRoot, '_queue', 'ready-for-review', `${id}.md`),
      manifestMd({ initiative_id: id, cycle_id: cycleId, project_repo_path: repo, worktree_path: wt }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
      finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
    });
    try {
      const { status, json } = await postVerdict(url, {
        initiativeId: id,
        kind: 'send-back',
        rationale: 'x',
        acceptanceCriteria: [{ given: 'a', when: 'b', then: 'c' }],
      });
      assert.equal(status, 200, `expected a legitimate send-back to succeed — got ${status}: ${JSON.stringify(json)}`);
      const body = json as Record<string, unknown>;
      assert.deepEqual(body.appendedWorkItems, ['WI-1'], 'the verdict must still actually apply — a fix work item is appended, not just a status code');

      const verdictPath = join(forgeRoot, '_logs', cycleId, 'artifacts', 'verdict.json');
      assert.ok(existsSync(verdictPath), `expected verdict.json under the real cycleId dir — missing at ${verdictPath}`);
      const eventsPath = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
      assert.ok(existsSync(eventsPath), `expected events.jsonl under the real cycleId dir — missing at ${eventsPath}`);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SEC-02 round 5: a guard-symmetry hole of a different KIND from rounds 1-4
// — not a containment bypass, but an ARBITRARY-ABSOLUTE-PATH EXISTENCE
// ORACLE on the send-back branch. The approve branch (round 1) is correctly
// ordered:
//   empty check (no stat) -> containment check -> existsSync (AFTER containment)
// with its own comment stating the containment check was "deliberately moved
// AHEAD of the existsSync probe ... an out-of-bounds path must never even be
// stat'd through this route." The send-back branch (~L361) never got that
// treatment — it stats FIRST:
//   if (!worktreePath || !existsSync(worktreePath)) { 409 'no live worktree...' }
//   if (!isContainedWorktreePath(...)) { 409 'worktree_path outside allowed root' }
// So for an out-of-bounds worktree_path, the response TEXT differs by
// whether the path exists on disk — a one-bit existence probe for ANY
// absolute path on the server, the exact class `forge-b2k` exists to close.
// ---------------------------------------------------------------------------

test('(RED) [SEC-02 round 5] send-back: an out-of-bounds worktree_path is an existence oracle — EXISTING vs NON-EXISTING outside paths must be INDISTINGUISHABLE', async () => {
  const forgeRoot = setupForgeRoot();
  const outsideParent = mkdtempSync(join(tmpdir(), 'r5-sendback-outside-'));
  try {
    // Case A: a REAL directory outside forgeRoot.
    const existingOutside = join(outsideParent, 'exists');
    mkdirSync(existingOutside, { recursive: true });
    const idA = 'INIT-2026-01-01-r5-sb-exists';
    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${idA}.md`),
      manifestMd({ initiative_id: idA, worktree_path: existingOutside }),
    );

    // Case B: the SAME parent, a name that was never created.
    const nonExistingOutside = join(outsideParent, 'never-created');
    const idB = 'INIT-2026-01-01-r5-sb-absent';
    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${idB}.md`),
      manifestMd({ initiative_id: idB, worktree_path: nonExistingOutside }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
      finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
    });
    try {
      const ac = [{ given: 'a', when: 'b', then: 'c' }];
      const resA = await postVerdict(url, { initiativeId: idA, kind: 'send-back', rationale: 'x', acceptanceCriteria: ac });
      const resB = await postVerdict(url, { initiativeId: idB, kind: 'send-back', rationale: 'x', acceptanceCriteria: ac });

      assert.equal(
        resA.status,
        resB.status,
        `existing vs non-existing out-of-bounds worktree_path must yield the SAME status — got A=${resA.status} (${JSON.stringify(resA.json)}) vs B=${resB.status} (${JSON.stringify(resB.json)})`,
      );

      // The pin: assert on the actual body, not just the status — the whole
      // point is that the error TEXT leaks the bit today.
      const normalize = (json: unknown, id: string): string => JSON.stringify(json).split(id).join('<id>');
      assert.equal(
        normalize(resA.json, idA),
        normalize(resB.json, idB),
        `the response body must be INDISTINGUISHABLE once the initiative id is normalized out — otherwise this is a one-bit existence oracle for any absolute path on the server. A=${JSON.stringify(resA.json)} B=${JSON.stringify(resB.json)}`,
      );
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outsideParent, { recursive: true, force: true });
  }
});

test('non-regression [SEC-02 round 5]: send-back with a LEGITIMATE (contained) but non-existent worktree_path still gets the ordinary "no live worktree" 409 — the fix must not collapse this into the containment rejection', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const id = 'INIT-2026-01-01-r5-sb-legit-absent';
    const wt = join(forgeRoot, '_worktrees', id); // identity-bound, contained — deliberately never created
    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${id}.md`),
      manifestMd({ initiative_id: id, worktree_path: wt }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
      finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
    });
    try {
      const { status, json } = await postVerdict(url, {
        initiativeId: id,
        kind: 'send-back',
        rationale: 'x',
        acceptanceCriteria: [{ given: 'a', when: 'b', then: 'c' }],
      });
      assert.equal(status, 409, `expected 409 — got ${status}: ${JSON.stringify(json)}`);
      assert.equal(
        (json as Record<string, unknown>).error,
        'no live worktree for this cycle (already cleaned up?) — cannot append review work items',
        `a legitimate but cleaned-up worktree must still report the ORDINARY "gone" message, never a generic containment-rejection message (that would be "the fix is just: return one message for everything", not the real invariant) — got ${JSON.stringify(json)}`,
      );
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('regression lock [SEC-02 round 5]: approve — out-of-bounds worktree_path is ALREADY correctly indistinguishable (existing vs non-existing) — pins the ordering against a future silent regression', async () => {
  const forgeRoot = setupForgeRoot();
  const outsideParent = mkdtempSync(join(tmpdir(), 'r5-approve-outside-'));
  try {
    const existingOutside = join(outsideParent, 'exists');
    mkdirSync(existingOutside, { recursive: true });
    const idA = 'INIT-2026-01-01-r5-appr-exists';
    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${idA}.md`),
      manifestMd({ initiative_id: idA, worktree_path: existingOutside }),
    );

    const nonExistingOutside = join(outsideParent, 'never-created');
    const idB = 'INIT-2026-01-01-r5-appr-absent';
    writeFileSync(
      join(forgeRoot, '_queue', 'in-flight', `${idB}.md`),
      manifestMd({ initiative_id: idB, worktree_path: nonExistingOutside }),
    );

    const { url, close } = await startBridge({
      forgeRoot,
      port: 0,
      mergePr: () => true,
      finalizeAfterMerge: async () => {},
      runReleaseFinalize: async () => ({ release_status: 'skipped' }),
    });
    try {
      const resA = await postVerdict(url, { initiativeId: idA, kind: 'approve', rationale: 'x' });
      const resB = await postVerdict(url, { initiativeId: idB, kind: 'approve', rationale: 'x' });

      assert.equal(
        resA.status,
        resB.status,
        `existing vs non-existing out-of-bounds worktree_path must yield the SAME status on the approve branch — got A=${resA.status} vs B=${resB.status}`,
      );
      const normalize = (json: unknown, id: string): string => JSON.stringify(json).split(id).join('<id>');
      assert.equal(
        normalize(resA.json, idA),
        normalize(resB.json, idB),
        `regression lock: the approve branch's response body must stay INDISTINGUISHABLE between an existing and a non-existing out-of-bounds worktree_path — A=${JSON.stringify(resA.json)} B=${JSON.stringify(resB.json)}`,
      );
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outsideParent, { recursive: true, force: true });
  }
});
