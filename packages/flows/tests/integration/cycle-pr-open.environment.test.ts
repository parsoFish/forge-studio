/**
 * `openPrInline` — the environment/DNS PR-open failure path. Bead
 * `forge-8vfn.8.1.24` / T1 ruling 1609.
 *
 * THE DEFECT (verified from a live run). At the PR-open step a DNS outage made
 * `gh api user --jq .login` fail with "error connecting to api.github.com".
 * `openPrInline` reported this as `unifier.prerequisite-missing` with
 * `missing: []` and threw the generic "missing prerequisites: " message —
 * the wrong cause, and an empty list, even though both `.forge/pr-description.md`
 * and the tracked demo bundle existed. `failure_classifier.ts` then matched
 * `reviewer.pr-open-failed` before it ever saw a DNS signature and classified
 * the cycle `unifierNoDemo` (terminal), so the manifest landed in `_queue/failed/`
 * on the FIRST hit of a transient network outage instead of parking for retry.
 *
 * These tests assert the fixed contract end to end through REAL code (real
 * `openPullRequest`, real `openPrInline`, real `classifyCycleFailure` — no
 * mocked collaborators):
 *   - both prerequisites present + an environment failure → no
 *     `unifier.prerequisite-missing` event, the error rides in
 *     `reviewer.pr-open-failed`'s `metadata.error` and in the thrown message,
 *     `classifyCycleFailure` reads `environment:true, recoverable:true` (never
 *     `unifierNoDemo`), and the manifest is stamped `resume_from: 'integrate'`
 *     (ADR 019) so a resume reuses the preserved worktree/branch instead of
 *     wiping `.forge/work-items/` and rebuilding from scratch.
 *   - the tracked demo bundle GENUINELY missing → the original
 *     `unifier.prerequisite-missing` behaviour is unchanged, and NO resume
 *     marker is stamped (this is a real defect, not an environment blip).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyCycleFailure } from '@forge/agents';
import { createLogger, type EventLogEntry } from '@forge/kernel';

import { openPrInline } from '../../cycle-pr-open.ts';
import { __resetGhRunnerCache } from '../../gh-pinned.ts';
import { parseManifest, serializeManifest, type InitiativeManifest } from '../../manifest.ts';
import type { CycleInput } from '../../cycle-context.ts';

const OWNER = 'parsoFish';
const GITHUB_URL = `https://github.com/${OWNER}/forge-test.git`;
const INIT = 'INIT-2026-09-27-pr-open-dns';
const BRANCH = `forge/${INIT}`;

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** Same `pushInsteadOf` trick as pr.open-pull-request.test.ts (see that file's
 *  header for why plain `insteadOf` will not do): the push transport is local,
 *  but `git remote get-url origin` still reports the github.com URL so
 *  `githubOwnerRepoForWorktree` resolves an owner and the `gh` pin engages. */
function setupRepo(withDemo: boolean): { root: string; proj: string; manifestPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-openprinline-'));
  const proj = join(root, 'proj');
  mkdirSync(proj, { recursive: true });
  sh(proj, ['init', '-q', '-b', 'main']);
  sh(proj, ['config', 'user.email', 't@forge']);
  sh(proj, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(proj, 'README.md'), 'base\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'base']);

  const bareOrigin = join(root, 'origin.git');
  sh(proj, ['init', '-q', '--bare', bareOrigin]);
  sh(proj, ['remote', 'add', 'origin', GITHUB_URL]);
  sh(proj, ['config', `url.${bareOrigin}.pushInsteadOf`, GITHUB_URL]);
  sh(proj, ['push', '-q', 'origin', 'main']);

  sh(proj, ['checkout', '-q', '-b', BRANCH]);
  if (withDemo) {
    mkdirSync(join(proj, 'demo', INIT), { recursive: true });
    // Both files: openPullRequest's own precondition (assertTrackedDemoExists)
    // checks demo.json; openPrInline's OWN missing-prerequisite diagnostic
    // (worktreeDemoMdPath) checks DEMO.md — a genuine "both prerequisites
    // present" scenario needs both on disk.
    writeFileSync(join(proj, 'demo', INIT, 'demo.json'), JSON.stringify({ title: 't' }));
    writeFileSync(join(proj, 'demo', INIT, 'DEMO.md'), '# Demo\n');
  }
  mkdirSync(join(proj, '.forge'), { recursive: true });
  writeFileSync(join(proj, '.forge', 'pr-description.md'), '# PR body\n');
  writeFileSync(join(proj, 'feature.txt'), 'work\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'feat: work']);

  const manifest: InitiativeManifest = {
    initiative_id: INIT,
    class: 'code',
    acceptance_criteria: [],
    project: 'forge-test',
    project_repo_path: proj,
    created_at: '2026-09-27T00:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: 25,
    phase: 'in-flight',
    origin: 'architect',
    body: '# body',
  };
  const manifestPath = join(root, `${INIT}.md`);
  writeFileSync(manifestPath, serializeManifest(manifest));

  return { root, proj, manifestPath };
}

/** Same DNS-outage `gh` shim as pr.open-pull-request.test.ts. */
function withDnsOutageGhShim(root: string): string {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'gh');
  writeFileSync(
    shim,
    `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === 'auth' && a[1] === 'token') { console.log('gho_test_token'); process.exit(0); }
if (a[0] === 'api' && a[1] === 'user') { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
process.stderr.write('unsupported: ' + a.join(' ') + '\\n');
process.exit(1);
`,
  );
  chmodSync(shim, 0o755);
  return binDir;
}

function withPath<T>(binDir: string, fn: () => T): T {
  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}:${originalPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

function readEvents(logFilePath: string): EventLogEntry[] {
  return readFileSync(logFilePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EventLogEntry);
}

test('openPrInline: DNS/environment PR-open failure with both prerequisites present — no prerequisite-missing, error named, resume_from:integrate stamped', async () => {
  const { root, proj, manifestPath } = setupRepo(true);
  try {
    __resetGhRunnerCache();
    const binDir = withDnsOutageGhShim(root);

    const logsDir = join(root, '_logs');
    const logger = createLogger('TEST-openprinline-dns', logsDir);
    const input = { initiativeId: INIT, worktreePath: proj, manifestPath } as CycleInput;

    await withPath(binDir, () =>
      assert.rejects(
        () => openPrInline(input, logger),
        (err: Error) => {
          assert.match(err.message, /^reviewer\.pr-open-failed: /);
          assert.match(err.message, /error connecting to api\.github\.com/);
          assert.doesNotMatch(err.message, /missing prerequisites/);
          return true;
        },
      ),
    );

    const events = readEvents(logger.logFilePath);
    assert.equal(
      events.find((e) => e.message === 'unifier.prerequisite-missing'),
      undefined,
      'no prerequisite-missing event when both prerequisites exist',
    );
    const failedEvt = events.find((e) => e.message === 'reviewer.pr-open-failed');
    assert.ok(failedEvt, 'reviewer.pr-open-failed event emitted');
    const md = failedEvt!.metadata as { url: null; pr_created: boolean; error: string };
    assert.equal(md.pr_created, false);
    assert.match(md.error, /error connecting to api\.github\.com/);

    // ADR 019 resume marker — stamped directly by openPrInline on an
    // environment failure so F-27's ordinary pending-requeue resumes at
    // `integrate` instead of wiping `.forge/work-items/` and rebuilding.
    const onDisk = parseManifest(readFileSync(manifestPath, 'utf8'));
    assert.equal(onDisk.resume_from, 'integrate');

    // classifyCycleFailure (the same function runCycle's catch calls) must
    // read this as environment/transient, never unifierNoDemo terminal —
    // this is the exact classification chain `emitFailureClassification`
    // drives in cycle.ts, replayed here against the REAL orchestrator error
    // event runCycle's own catch would emit for this exact throw.
    const orchestratorErrorEvent: EventLogEntry = {
      ...failedEvt!,
      event_id: 'synthetic-orchestrator-error',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: `reviewer.pr-open-failed: ${md.error}`,
    };
    const cls = classifyCycleFailure([...events, orchestratorErrorEvent]);
    assert.equal(cls.environment, true, `expected environment:true, got ${JSON.stringify(cls)}`);
    assert.equal(cls.kind, 'transient');
    assert.equal(cls.recoverable, true);
    assert.doesNotMatch(cls.reason, /unifier did not author the PR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('openPrInline: DEMO.md genuinely missing — unchanged prerequisite-missing behaviour, NO resume marker stamped', async () => {
  const { root, proj, manifestPath } = setupRepo(false); // no demo/<id>/demo.json
  try {
    const logsDir = join(root, '_logs');
    const logger = createLogger('TEST-openprinline-missing-demo', logsDir);
    const input = { initiativeId: INIT, worktreePath: proj, manifestPath } as CycleInput;

    await assert.rejects(
      () => openPrInline(input, logger),
      (err: Error) => {
        assert.match(err.message, /missing prerequisites/);
        assert.match(err.message, new RegExp(`demo/${INIT}/DEMO\\.md`));
        return true;
      },
    );

    const events = readEvents(logger.logFilePath);
    const missingEvt = events.find((e) => e.message === 'unifier.prerequisite-missing');
    assert.ok(missingEvt, 'unifier.prerequisite-missing event emitted for a genuine defect');
    const md = missingEvt!.metadata as { missing: string[] };
    assert.ok(md.missing.includes(`demo/${INIT}/DEMO.md`));

    // A genuine defect must NOT park for an environment retry.
    const onDisk = parseManifest(readFileSync(manifestPath, 'utf8'));
    assert.equal(onDisk.resume_from, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
