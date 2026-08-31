/**
 * ACCEPTANCE TESTS (T3, R2-08-F3 #9, #11) — the RECEIVER PATH for the two
 * new project-event trigger kinds (`pr-merged` / `issue-raised`), driven at
 * the REAL bridge route exactly as cli/bridge-hooks.test.ts already does for
 * push/release. New file (not appended to the existing 484-line
 * bridge-hooks.test.ts) per the small-focused-files rule; the two files
 * share no helper exports (bridge-hooks.test.ts's setup()/post()/githubSig()
 * are module-local, not exported), so the small duplication below is
 * deliberate, not an oversight.
 *
 * PINNED WIRE CONTRACT (forward pin — genuinely underspecified by the
 * roadmap text at the level of precision needed to construct a fixture;
 * escalated in this WI's report for T1's ruling):
 *   - A flow declares `on: pr-merged` / `on: issue-raised` directly — their
 *     OWN TRIGGER_KINDS id (orchestrator/flow-trigger.test.ts pins these as
 *     real registry rows) — carrying a `webhook: {...}` receive/trust config
 *     block of the SAME shape existing webhook triggers use (id/provider/
 *     secretEnv/sources), at the SAME `/api/hooks/:hookId` route ("over the
 *     EXISTING webhook receiver" per the roadmap text).
 *   - A GitHub `pull_request` delivery (header `x-github-event: pull_request`)
 *     with `action:"closed"` + `pull_request.merged:true` is what fires
 *     `on: pr-merged`; the SAME event shape with `merged:false` (closed, not
 *     merged) must NOT fire it (test #11 — a merged:false close is a sibling
 *     GitHub delivery with no shipped row; it must not be silently accepted
 *     by an "any pull_request event" stub).
 *
 * If the implementer lands a different wire shape (e.g. pr-merged reusing
 * `on: webhook` + a new `events:` value instead of its own `on:`), these
 * tests stay RED and must be renegotiated with T1 — same precedent as
 * orchestrator/flow-trigger-projects.test.ts (R2-08-F1).
 *
 * CORPUS GROUNDING: the `pull_request` webhook payload shape below
 * (`action`, `number`, `pull_request.{number,title,body,merged,merged_at,
 * head,base,user}`, `repository.full_name`, `sender.login`) is GitHub's
 * documented, stable webhook event schema for the `pull_request` event —
 * NOT drawn from this repo's local test corpus (no local pull_request/issues
 * fixtures exist yet; only push/release do, in
 * orchestrator/trigger-payload.test.ts / cli/bridge-hooks.test.ts) and NOT
 * invented ad hoc — it mirrors the well-known, stable GitHub API field names.
 * See this WI's report for the explicit per-fixture provenance statement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../cli/ui-bridge.ts';

const SECRET_ENV = 'TEST_BRIDGE_PR_MERGED_HOOK_SECRET';
const FLOW_ID = 'pr-merged-fixture-flow';
const TARGET_FLOW_ID = 'pr-merged-fixture-target';
const HOOK_ID = 'pr-merged-fixture-hook';
const ALLOWED_REPO = 'acme/widgets';
const PROJECT_DIR = 'widgets-project';

function githubSig(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

/**
 * Fresh forgeRoot: TARGET_FLOW_ID (dispatch target, never run — staging
 * only), FLOW_ID (declares the `on: pr-merged` trigger under test, SCOPED to
 * `projects: [PROJECT_DIR]`), and a REAL project directory declaring
 * `repo: ALLOWED_REPO` — the R2-08-F3 declaration this hook's resolution
 * must read (orchestrator/project-config-repo.test.ts pins the field itself;
 * orchestrator/project-event-resolve.test.ts pins the resolution function).
 */
function setup(): { forgeRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-hooks-project-events-'));
  const flowsDir = join(forgeRoot, 'studio', 'flows');

  const targetDir = join(flowsDir, TARGET_FLOW_ID);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    join(targetDir, 'flow.yaml'),
    [
      `id: ${TARGET_FLOW_ID}`,
      'name: PR Merged Fixture Target',
      'version: 1',
      'goal: fixture target flow for pr-merged staging tests',
      'project: null',
      'kb: null',
      'costCeilingUsd: 5',
      'origin: seed',
      'nodes:',
      '  - { id: only, agent: developer-ralph }',
      'edges: []',
      'triggers: []',
      '',
    ].join('\n'),
  );

  const sourceDir = join(flowsDir, FLOW_ID);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, 'flow.yaml'),
    [
      `id: ${FLOW_ID}`,
      'name: PR Merged Fixture Flow',
      'version: 1',
      'goal: fixture flow declaring an on:pr-merged trigger for R2-08-F3 receiver tests',
      'project: null',
      'kb: null',
      'costCeilingUsd: 5',
      'origin: seed',
      'nodes:',
      '  - { id: only, agent: developer-ralph }',
      'edges: []',
      'triggers:',
      '  - on: pr-merged',
      `    target: { kind: flow, ref: ${TARGET_FLOW_ID} }`,
      `    projects: [${PROJECT_DIR}]`,
      '    webhook:',
      `      id: ${HOOK_ID}`,
      '      provider: github',
      '      events: [pull_request]',
      `      secretEnv: ${SECRET_ENV}`,
      '      sources:',
      `        - ${ALLOWED_REPO}`,
      '',
    ].join('\n'),
  );

  const projDir = join(forgeRoot, 'projects', PROJECT_DIR, '.forge');
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, repo: ALLOWED_REPO }),
  );

  return { forgeRoot };
}

function flowRunFiles(forgeRoot: string): string[] {
  const dir = join(forgeRoot, '_queue', 'flow-runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json'));
}

/**
 * A REAL GitHub `pull_request` webhook delivery shape (documented, stable —
 * see the corpus-grounding note in this file's header). `merged` distinguishes
 * a merge (must fire pr-merged) from a plain close (must NOT — test #11).
 */
function pullRequestBody(merged: boolean, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'closed',
    number: 42,
    pull_request: {
      number: 42,
      title: 'Add widget support',
      body: 'Implements the widget feature.',
      merged,
      merged_at: merged ? '2026-08-07T12:00:00Z' : null,
      head: { ref: 'feature/widgets', sha: 'a'.repeat(40) },
      base: { ref: 'main' },
      user: { login: 'octocat' },
    },
    repository: { full_name: ALLOWED_REPO },
    sender: { login: 'octocat' },
    ...overrides,
  };
}

async function post(
  url: string,
  path: string,
  rawBody: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  });
  // Read the response body ONCE into a variable — never call res.text()/
  // res.json() inside an assertion's message argument. JS evaluates message
  // args eagerly, so a second read there throws "Body is unusable" — making
  // the test unpassable regardless of production correctness. That exact bug
  // already cost this initiative a round (per the WI brief).
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON body (e.g. an error page) tolerated */ }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// #9 — a signed, in-scope pr-merged delivery stages a run request carrying
// the resolved eventProject and the trigger's projects.
// ---------------------------------------------------------------------------

test('(RED) [F3 #9] a signed, in-scope pr-merged delivery stages a run request carrying the resolved eventProject and the trigger\'s projects', async () => {
  const { forgeRoot } = setup();
  const saved = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = 'correct-secret';
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const raw = JSON.stringify(pullRequestBody(true));
    const { status, json } = await post(url, `/api/hooks/${HOOK_ID}`, raw, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': githubSig('correct-secret', raw),
    });
    assert.equal(status, 202, `expected the signed pr-merged delivery to stage — got ${status} ${JSON.stringify(json)}`);

    const files = flowRunFiles(forgeRoot);
    assert.equal(files.length, 1, 'exactly one flow-run request staged');
    const reqRaw = readFileSync(join(forgeRoot, '_queue', 'flow-runs', files[0]), 'utf8');
    const req = JSON.parse(reqRaw) as Record<string, unknown>;

    assert.equal(req.origin, 'webhook');
    assert.deepEqual(req.target, { kind: 'flow', ref: TARGET_FLOW_ID });
    assert.deepEqual(
      req.projects,
      [PROJECT_DIR],
      `expected the staged request to carry the trigger's declared projects: — got ${reqRaw}`,
    );
    assert.equal(
      req.eventProject,
      PROJECT_DIR,
      `expected eventProject to be the resolved project id (${PROJECT_DIR}, matching the declared repo: ${ALLOWED_REPO}) — got ${reqRaw}`,
    );
  } finally {
    if (saved === undefined) delete process.env[SECRET_ENV]; else process.env[SECRET_ENV] = saved;
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #11 — unshipped provider events stay schema-reserved with zero stubs: a PR
// closed WITHOUT merging is a sibling GitHub delivery to the SAME hook/event
// header that must NOT stage anything — proving there is no "any
// pull_request event" stub silently accepting it.
//
// NOTE on why this reads as green-on-arrival right now: on 631154a1,
// `on: pr-merged` is not recognised by findWebhookTrigger AT ALL, so every
// delivery to this hook 404s ("unknown hook") regardless of merged status —
// this assertion trivially holds today for an unrelated reason. It becomes
// the REAL regression pin — proving the merged:true/false branch, not just
// route existence — once test #9 makes the route real. Both are asserted so
// a reviewer can see which mechanism is producing the pass at each point in
// time; the zero-staged-files assertion is the one that must hold in both
// worlds.
// ---------------------------------------------------------------------------

test('(RED) [F3 #11] a PR closed WITHOUT merging (same hook, same event header) never stages — no "any pull_request event" stub', async () => {
  const { forgeRoot } = setup();
  const saved = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = 'correct-secret';
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const raw = JSON.stringify(pullRequestBody(false));
    const { status, json } = await post(url, `/api/hooks/${HOOK_ID}`, raw, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': githubSig('correct-secret', raw),
    });
    assert.notEqual(
      status,
      202,
      `a merged:false PR-closed delivery must NOT be accepted as a stage-worthy pr-merged event — got ${status} ${JSON.stringify(json)}`,
    );
    assert.equal(
      flowRunFiles(forgeRoot).length,
      0,
      'kills a stub that stages for ANY pull_request delivery regardless of merged status — assert the artifact (no staged file), not just the status code',
    );
  } finally {
    if (saved === undefined) delete process.env[SECRET_ENV]; else process.env[SECRET_ENV] = saved;
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
