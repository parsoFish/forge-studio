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

import { startBridge } from './ui-bridge.ts';

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
