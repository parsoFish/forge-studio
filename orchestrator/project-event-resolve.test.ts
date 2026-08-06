/**
 * ACCEPTANCE TESTS (T3, R2-08-F3 #3-#8) — repo→project RESOLUTION, the crux
 * of "project-event trigger kinds". Per the ruling brief:
 *
 *   - Resolution is an IDENTITY match of the payload's repo against declared
 *     `repo` values (orchestrator/project-config-repo.test.ts pins the field
 *     itself); the result is the project's ENUMERATION id
 *     (orchestrator/studio/registry.ts `discoverProjects` / `normalizeProjectId`),
 *     never the payload string, never the raw directory name.
 *   - Undeclared `repo` ⇒ FAILS CLOSED. No auto-discover arm. No
 *     name-matching fallback. Ambiguity (two projects declaring the same
 *     repo) fails closed too — never an arbitrary pick.
 *
 * PINNED CONTRACT (forward pin — no such export exists yet on 631154a1;
 * verified at runtime via `--experimental-strip-types`, which erases type
 * annotations without checking them, so these tests run and fail on
 * ASSERTIONS/exports, not on TS compile errors):
 *
 *   orchestrator/project-config.ts exports
 *     resolveProjectIdForRepo(forgeRoot: string, repo: string): string | null
 *
 * This mirrors `discoverProjects(projectsDir, forgeRoot)`'s own call-site
 * convention (bridge-studio.ts, studio-lint.ts: resolveProjectsDir(forgeRoot)
 * then discoverProjects(projectsDir, forgeRoot)) and sits in project-config.ts
 * because that module already owns "everything about `.forge/project.json`"
 * (readAgentInstructionsFile, readQualityGateSidecar sit beside the loader
 * the same way). This is a REASONABLE forward pin, not a certainty — flag for
 * T1's ruling if the implementer lands a different name/module; renegotiate
 * exactly as the R2-08-F1 precedent (flow-trigger-projects.test.ts) did.
 *
 * Every call site below goes through a DYNAMIC `await import(...)` + a
 * `typeof fn === 'function'` guard (mirroring
 * orchestrator/trigger-harness-guard.test.ts's `fireAgentCompleteTriggers`
 * precedent) so a missing export fails ONLY the individual test that needs
 * it, never the whole file's collection — `project-config.ts` itself already
 * exists, so the dynamic import always succeeds; only the named export may
 * be absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { normalizeProjectId } from './studio/registry.ts';
import { stageFlowRunRequest, drainFlowRunRequests, type FlowRunRequest } from './flow-run-requests.ts';

type Resolver = (forgeRoot: string, repo: string) => string | null;

async function loadResolver(): Promise<Resolver | undefined> {
  const mod = (await import('./project-config.ts')) as unknown as Record<string, unknown>;
  return mod['resolveProjectIdForRepo'] as Resolver | undefined;
}

async function requireResolver(): Promise<Resolver> {
  const resolve = await loadResolver();
  assert.equal(
    typeof resolve,
    'function',
    'expected orchestrator/project-config.ts to export resolveProjectIdForRepo(forgeRoot, repo) — R2-08-F3 pinned contract (see this file\'s header comment)',
  );
  return resolve!;
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Write a minimal, always-VALID `.forge/project.json` under `<projectsDir>/<dirName>`. */
function writeProject(projectsDir: string, dirName: string, extra: Record<string, unknown> = {}): void {
  const dir = join(projectsDir, dirName, '.forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, ...extra }),
  );
}

type ScopedRequestInput = Omit<FlowRunRequest, 'createdAt'> & {
  createdAt?: string;
  projects?: string[];
  eventProject?: string | null;
};

/** Stage via the REAL stageFlowRunRequest path (never a hand-built JSON blob). */
let stageCounter = 0;
function stage(req: ScopedRequestInput, queueRoot: string): void {
  const createdAt = req.createdAt ?? `2026-08-07T00:00:00.${String(stageCounter++).padStart(3, '0')}Z`;
  stageFlowRunRequest(
    { ...req, createdAt } as unknown as Parameters<typeof stageFlowRunRequest>[0],
    { queueRoot },
  );
}

// ---------------------------------------------------------------------------
// #3 — the crux: resolves to the ENUMERATION id, never the raw payload
// string, never the raw directory name.
// ---------------------------------------------------------------------------

test('(RED) [F3 #3] a payload repo matching a declared repo resolves to the ENUMERATION id — never the raw payload repo, never the raw dir name', async () => {
  const resolve = await requireResolver();
  const forgeRoot = tmp('r2-08-f3-crux-');
  try {
    // A dir name NEEDING normalization (mixed case + underscore) — proves the
    // returned id is normalizeProjectId's output, not the literal dir name.
    writeProject(join(forgeRoot, 'projects'), 'My_Project', { repo: 'acme/my-project' });

    const result = resolve(forgeRoot, 'acme/my-project');

    assert.equal(
      result,
      normalizeProjectId('My_Project'),
      `expected the ENUMERATION id (normalizeProjectId's output) — got ${JSON.stringify(result)}`,
    );
    assert.notEqual(result, 'acme/my-project', 'must never be the raw payload repo string');
    assert.notEqual(result, 'My_Project', 'must never be the raw, un-normalized directory name');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #4 — undeclared repo fails closed. No fallback to directory-name/tail
// matching, even when the directory name would match the payload's tail.
// ---------------------------------------------------------------------------

test('(RED) [F3 #4] an undeclared repo never resolves — kills falling back to directory-name/tail matching', async () => {
  const resolve = await requireResolver();
  const forgeRoot = tmp('r2-08-f3-undeclared-');
  try {
    // 'gitpulse' exists and is a real project, but declares NO repo: field.
    // Its directory name matches the payload repo's tail exactly — the ONE
    // scenario a name-matching fallback would (wrongly) resolve.
    writeProject(join(forgeRoot, 'projects'), 'gitpulse');

    const result = resolve(forgeRoot, 'someorg/gitpulse');

    assert.equal(
      result,
      null,
      `kills "fall back to name matching" for an undeclared repo — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #5 — no auto-discover (zero projects declaring repo resolves + stages
// nothing) AND the in-scope twin (one project declaring repo DOES resolve +
// dispatch) — BOTH in the same test, so a broken fixture can't pass silently.
// ---------------------------------------------------------------------------

test('(RED) [F3 #5] zero projects declaring repo resolves+stages nothing; the in-scope twin (one declaring project) DOES resolve+dispatch — both in the SAME test', async () => {
  const resolve = await requireResolver();

  // --- Part A: no auto-discover -------------------------------------------
  const forgeRootA = tmp('r2-08-f3-noauto-forgeroot-');
  const queueRootA = tmp('r2-08-f3-noauto-queue-');
  try {
    writeProject(join(forgeRootA, 'projects'), 'gitpulse'); // exists, declares no repo

    const resolvedA = resolve(forgeRootA, 'someorg/gitpulse');
    assert.equal(resolvedA, null, 'kills auto-discovering a project with no declared repo');

    let dispatchedA = false;
    stage(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'webhook',
        triggeredBy: 'no-autodiscover-fixture',
        projects: ['gitpulse'],
        eventProject: resolvedA,
      },
      queueRootA,
    );
    const resultsA = drainFlowRunRequests({
      queueRoot: queueRootA,
      startFlowRun: () => { dispatchedA = true; },
    });
    assert.equal(dispatchedA, false, 'nothing may dispatch when nothing resolved');
    assert.equal(resultsA[0]?.status, 'skipped-out-of-scope');
  } finally {
    rmSync(forgeRootA, { recursive: true, force: true });
    rmSync(queueRootA, { recursive: true, force: true });
  }

  // --- Part B: the in-scope twin ------------------------------------------
  const forgeRootB = tmp('r2-08-f3-inscope-forgeroot-');
  const queueRootB = tmp('r2-08-f3-inscope-queue-');
  try {
    writeProject(join(forgeRootB, 'projects'), 'gitpulse', { repo: 'someorg/gitpulse' });

    const resolvedB = resolve(forgeRootB, 'someorg/gitpulse');
    assert.equal(resolvedB, 'gitpulse', 'the declaring project must resolve');

    let dispatchedB = false;
    stage(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'webhook',
        triggeredBy: 'in-scope-twin-fixture',
        projects: ['gitpulse'],
        eventProject: resolvedB,
      },
      queueRootB,
    );
    const resultsB = drainFlowRunRequests({
      queueRoot: queueRootB,
      startFlowRun: () => { dispatchedB = true; },
    });
    assert.equal(
      dispatchedB,
      true,
      'the in-scope twin must dispatch — Part A\'s "nothing happened" alone would pass for a simply-broken fixture',
    );
    assert.equal(resultsB[0]?.status, 'dispatched');
  } finally {
    rmSync(forgeRootB, { recursive: true, force: true });
    rmSync(queueRootB, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #6 — ambiguity (two projects declaring the SAME repo) fails closed, never
// an arbitrary pick (e.g. Array.find's "first wins").
// ---------------------------------------------------------------------------

test('(RED) [F3 #6] two projects declaring the SAME repo — resolution fails closed, never picks one arbitrarily', async () => {
  const resolve = await requireResolver();
  const forgeRoot = tmp('r2-08-f3-ambiguous-');
  try {
    const projectsDir = join(forgeRoot, 'projects');
    writeProject(projectsDir, 'proj-a', { repo: 'acme/dup' });
    writeProject(projectsDir, 'proj-b', { repo: 'acme/dup' });

    const result = resolve(forgeRoot, 'acme/dup');

    assert.equal(
      result,
      null,
      `kills an implementation that arbitrarily picks the first/last matching project (e.g. Array.find) on ambiguity instead of failing closed — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #7 — containment: this is where payload text FIRST reaches project
// identity. Six malicious repo shapes must never resolve, never touch
// anything outside the projects root, and mint zero manifests when pushed
// through the REAL stage+drain pipeline.
// ---------------------------------------------------------------------------

test('(RED) [F3 #7] malicious payload-repo shapes never resolve, never touch anything outside the projects root, and mint zero manifests', async () => {
  const resolve = await requireResolver();
  const forgeRoot = tmp('r2-08-f3-containment-forgeroot-');
  const outsideDir = tmp('r2-08-f3-containment-outside-');
  const queueRoot = join(forgeRoot, '_queue');
  try {
    // ONE real, legitimately-declaring project — the thing an escape must
    // never accidentally land on or be confused with.
    writeProject(join(forgeRoot, 'projects'), 'gitpulse', { repo: 'acme/gitpulse' });

    writeFileSync(join(outsideDir, 'SENTINEL.txt'), 'containment sentinel\n');
    const sentinelBefore = readFileSync(join(outsideDir, 'SENTINEL.txt'), 'utf8');

    const outsideBasename = basename(outsideDir);
    const maliciousRepos: Array<{ label: string; repo: string }> = [
      { label: 'relative traversal', repo: `../../${outsideBasename}` },
      { label: 'percent-encoded traversal', repo: `..%2F..%2F${outsideBasename}` },
      { label: 'absolute path', repo: outsideDir },
      { label: 'escape-and-return (resembles the legit repo)', repo: 'acme/gitpulse/../gitpulse' },
      { label: 'case-only difference from the declared repo', repo: 'ACME/GITPULSE' },
      { label: 'empty string', repo: '' },
    ];

    for (const { label, repo } of maliciousRepos) {
      const result = resolve(forgeRoot, repo);
      assert.equal(result, null, `[${label}] must never resolve — got ${JSON.stringify(result)}`);
    }

    assert.equal(
      readFileSync(join(outsideDir, 'SENTINEL.txt'), 'utf8'),
      sentinelBefore,
      'the outside sentinel bytes must be byte-unchanged after resolving every malicious shape',
    );

    // Push each (necessarily-null) resolution through the REAL stage+drain
    // pipeline exactly as a real caller would — assert the ARTIFACT, not just
    // the resolve() return value.
    mkdirSync(queueRoot, { recursive: true });
    let i = 0;
    for (const { label, repo } of maliciousRepos) {
      stage(
        {
          target: { kind: 'flow', ref: 'demo-runner-flow' },
          origin: 'webhook',
          triggeredBy: `containment-${label.replace(/[^a-z0-9]+/gi, '-')}`,
          projects: ['gitpulse'],
          eventProject: resolve(forgeRoot, repo),
          createdAt: new Date(Date.now() + i++).toISOString(),
        },
        queueRoot,
      );
    }
    const results = drainFlowRunRequests({
      queueRoot,
      startFlowRun: () => { throw new Error('must not dispatch — every malicious shape must fail closed'); },
    });
    assert.ok(
      results.every((r) => (r.status as string) === 'skipped-out-of-scope'),
      `expected every malicious shape to be a typed out-of-scope skip — got ${JSON.stringify(results.map((r) => r.status))}`,
    );
    const pendingDir = join(queueRoot, 'pending');
    const minted = existsSync(pendingDir) ? readdirSync(pendingDir).filter((f) => f.endsWith('.md')) : [];
    assert.equal(minted.length, 0, `expected zero manifests minted — found ${minted.length}: ${JSON.stringify(minted)}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #8 — the resolved value that flows onward is the ENUMERATION id, never the
// payload string. Construct a case where they deliberately differ.
// ---------------------------------------------------------------------------

test('(RED) [F3 #8] the resolved value that flows onward is the ENUMERATION id, never the payload repo string', async () => {
  const resolve = await requireResolver();
  const forgeRoot = tmp('r2-08-f3-idnotstring-forgeroot-');
  const queueRoot = tmp('r2-08-f3-idnotstring-queue-');
  try {
    // The directory's normalized id and the declared repo string are
    // deliberately unrelated text, so any accidental leak of the raw repo
    // string is unambiguous.
    const repoString = 'Acme-Corp/Widgets.App';
    writeProject(join(forgeRoot, 'projects'), 'Totally_Different_Dir', { repo: repoString });

    const id = resolve(forgeRoot, repoString);
    assert.equal(id, normalizeProjectId('Totally_Different_Dir'));
    assert.notEqual(id, repoString);

    // No `payload` field here deliberately — this fixture pins ONLY the
    // resolve()+stage() combo, so "the raw repo string appears nowhere in
    // the staged request" is checkable across the WHOLE file byte-for-byte.
    stage(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'webhook',
        triggeredBy: 'id-not-string-fixture',
        projects: [id as string],
        eventProject: id,
      },
      queueRoot,
    );
    // stageFlowRunRequest always writes under <queueRoot>/flow-runs/
    // (flow-run-requests.ts flowRunsDir) — never at queueRoot's top level.
    const files = readdirSync(join(queueRoot, 'flow-runs')).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'exactly one request staged');
    const raw = readFileSync(join(queueRoot, 'flow-runs', files[0]), 'utf8');
    const req = JSON.parse(raw) as Record<string, unknown>;

    assert.equal(req.eventProject, id, 'eventProject on the staged request must be the enumeration id');
    assert.notEqual(req.eventProject, repoString);
    assert.ok(
      !raw.includes(repoString),
      `the raw payload repo string must appear NOWHERE in the staged request — got ${raw}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(queueRoot, { recursive: true, force: true });
  }
});
