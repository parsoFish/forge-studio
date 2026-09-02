/**
 * Acceptance tests for server-side per-type provenance (bead forge-3oq,
 * exit row 14).
 *
 * Today `apps/studio/components/ProvenanceBadge.tsx` derives its badge from a
 * CLIENT-SIDE `provenanceOfFlowOrigin(flow.origin)`, and Flow is the only
 * Studio object type carrying a real per-object origin signal. This file
 * pins the fix: a server-side, per-type `provenance` field on the four
 * object types the Library page renders (flow/agent/project/kb —
 * apps/studio/app/library/page.tsx), honest per type, with the n/a-invariant —
 * a type the server cannot attest reports the literal string `'unknown'`,
 * NEVER a guessed badge.
 *
 * Scope lock (do not re-litigate): skills/hooks/templates/connections are
 * OUT of scope — each already has a field literally named `provenance`
 * meaning something else entirely (install-trust pin / category path /
 * attribution URL). This file never touches those.
 *
 * The seam pinned here:
 *   - the shared mapping, now `packages/kernel/provenance.ts` (moved from
 *     `cli/studio-provenance.ts` with QUARRY:76; its own cases live in
 *     `packages/kernel/provenance.test.ts`):
 *       export type Provenance = 'ootb' | 'operator' | 'unknown';
 *       export function provenanceOfOrigin(origin?: string | null): Provenance;
 *       export const AGENT_PROVENANCE: Provenance;   // 'unknown'
 *       export const PROJECT_PROVENANCE: Provenance; // 'unknown'
 *   - GET /api/studio/flows, /api/studio/agents, /api/studio/projects
 *     (cli/bridge-studio.ts) and GET /api/studio/kbs
 *     (cli/bridge-studio-kbs.ts) each add `provenance` to every descriptor.
 *   - orchestrator/studio/kb-descriptor.ts: KbDescriptor gains an OPTIONAL
 *     `origin?: string`; loadKbDescriptor reads it, serializeKbDescriptor
 *     writes it when present.
 *   - POST /api/studio/kbs (cli/bridge-studio-kbs.ts) stamps
 *     `origin: 'studio'` on create.
 *   - brain/cycles/kb.yaml + brain/forge-dev/kb.yaml (the two shipped OOTB
 *     brains) get `origin: seed` committed.
 *
 * RUN: node --test --experimental-strip-types cli/studio-provenance.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors cli/bridge-studio.test.ts / cli/bridge-studio-kbs.test.ts)
// ---------------------------------------------------------------------------

function makeFlowYaml(id: string, origin: string): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1',
    'goal: Test flow for provenance pins.',
    'project: null',
    'kb: null',
    'costCeilingUsd: 5',
    `origin: ${origin}`,
    'nodes:',
    '  - id: architect',
    '    agent: test-agent',
    'edges: []',
    'triggers: []',
  ].join('\n');
}

function makeSkillMd(): string {
  return [
    '---',
    'name: Test Agent',
    'description: A test agent for provenance pins.',
    'phase: architect',
    'purpose: Testing purposes only.',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: []',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Test Agent',
    '',
    'Agent body text.',
  ].join('\n');
}

/** KB with an explicit `origin:` line (or none, when `origin` is undefined). */
function makeKbYaml(id: string, bindingYaml: string, origin?: string): string {
  const lines = [
    `id: ${id}`,
    `name: ${id} KB`,
    bindingYaml,
    `desc: Test KB ${id} for provenance pins.`,
  ];
  if (origin !== undefined) lines.push(`origin: ${origin}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Shared fixture (AT-1, AT-2, AT-4, AT-5): one temp forgeRoot carrying a
// seeded + operator flow, one agent, one discovered project, a stamped OOTB
// kb, an operator-created kb, and an UNSTAMPED pre-existing project brain
// (no `origin:` key — the honest shape of every real brain/projects/*/kb.yaml
// on disk today).
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

const OOTB_FLOW_ID = 'ootb-flow';
const OPERATOR_FLOW_ID = 'operator-flow';
const OOTB_KB_ID = 'ootb-kb';
const OPERATOR_KB_ID = 'operator-kb';
const UNSTAMPED_KB_ID = 'legacy-project';
const PROJECT_ID = 'test-project';
const AGENT_SLUG = 'test-agent';

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'studio-provenance-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // -- skills/test-agent/SKILL.md (one studio agent) --
  mkdirSync(join(forgeRoot, 'skills', AGENT_SLUG), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', AGENT_SLUG, 'SKILL.md'), makeSkillMd());

  // -- studio/flows/ootb-flow (origin: seed) + operator-flow (origin: studio) --
  mkdirSync(join(forgeRoot, 'studio', 'flows', OOTB_FLOW_ID), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'flows', OOTB_FLOW_ID, 'flow.yaml'), makeFlowYaml(OOTB_FLOW_ID, 'seed'));
  mkdirSync(join(forgeRoot, 'studio', 'flows', OPERATOR_FLOW_ID), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'flows', OPERATOR_FLOW_ID, 'flow.yaml'), makeFlowYaml(OPERATOR_FLOW_ID, 'studio'));

  // -- projects/test-project/ (bare dir — discoverProjects surfaces it
  //    with id-as-name defaults, same as the house 'bare-project' fixture) --
  mkdirSync(join(forgeRoot, 'projects', PROJECT_ID), { recursive: true });

  // -- brain/ootb-kb/kb.yaml (origin: seed — a stamped OOTB brain) --
  mkdirSync(join(forgeRoot, 'brain', OOTB_KB_ID, 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', OOTB_KB_ID, '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', OOTB_KB_ID, 'kb.yaml'), makeKbYaml(OOTB_KB_ID, 'binding: { kind: unique }', 'seed'));

  // -- brain/operator-kb/kb.yaml (origin: studio — an operator-created brain) --
  mkdirSync(join(forgeRoot, 'brain', OPERATOR_KB_ID, 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', OPERATOR_KB_ID, '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', OPERATOR_KB_ID, 'kb.yaml'), makeKbYaml(OPERATOR_KB_ID, 'binding: { kind: unique }', 'studio'));

  // -- brain/projects/legacy-project/kb.yaml (NO origin key — the honest
  //    shape of every real brain/projects/*/kb.yaml on disk today) --
  mkdirSync(join(forgeRoot, 'brain', 'projects', UNSTAMPED_KB_ID, 'themes'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'brain', 'projects', UNSTAMPED_KB_ID, 'kb.yaml'),
    makeKbYaml(UNSTAMPED_KB_ID, `binding: { kind: project, ref: ${UNSTAMPED_KB_ID} }`),
  );

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeServer = result.close;
});

after(async () => {
  await closeServer?.();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function findById(rows: unknown, id: string): Record<string, unknown> {
  const arr = rows as Array<Record<string, unknown>>;
  const row = arr.find((r) => r['id'] === id);
  assert.ok(row, `expected an entry with id "${id}" in ${JSON.stringify(arr.map((r) => r['id']))}`);
  return row as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// AT-1 — per type (four tests): every list route returns a `provenance`
// field with the honest value. Kills: a field declared and serialized but
// always 'operator' / always 'ootb' (declared-data-fails-open, this
// campaign's #1 recurring defect).
// ---------------------------------------------------------------------------

test('AT-1 flow: GET /api/studio/flows reports provenance derived from the REAL origin field (seed->ootb, studio->operator)', async () => {
  const { status, json } = await get('/api/studio/flows');
  assert.equal(status, 200, JSON.stringify(json));
  const ootb = findById(json['flows'], OOTB_FLOW_ID);
  const operator = findById(json['flows'], OPERATOR_FLOW_ID);
  // origin stays on the wire unchanged (additive-only) — apps/studio/app/library/page.tsx:112
  // still reads flow.origin === 'studio' for the first-run onramp.
  assert.equal(ootb['origin'], 'seed');
  assert.equal(operator['origin'], 'studio');
  assert.equal(ootb['provenance'], 'ootb', `seeded flow must report 'ootb', got ${JSON.stringify(ootb['provenance'])}`);
  assert.equal(operator['provenance'], 'operator', `studio-origin flow must report 'operator', got ${JSON.stringify(operator['provenance'])}`);
});

test('AT-1 kb: GET /api/studio/kbs reports provenance derived from the (new) real origin field on kb.yaml', async () => {
  const { status, json } = await get('/api/studio/kbs');
  assert.equal(status, 200, JSON.stringify(json));
  const ootb = findById(json['kbs'], OOTB_KB_ID);
  const operator = findById(json['kbs'], OPERATOR_KB_ID);
  assert.equal(ootb['provenance'], 'ootb', `origin:seed kb must report 'ootb', got ${JSON.stringify(ootb['provenance'])}`);
  assert.equal(operator['provenance'], 'operator', `origin:studio kb must report 'operator', got ${JSON.stringify(operator['provenance'])}`);
});

test('AT-1 agent: GET /api/studio/agents reports provenance "unknown" for every agent (no on-disk origin signal exists)', async () => {
  const { status, json } = await get('/api/studio/agents');
  assert.equal(status, 200, JSON.stringify(json));
  // agents are keyed by `slug`, not `id`.
  const agents = json['agents'] as Array<Record<string, unknown>>;
  const row = agents.find((a) => a['slug'] === AGENT_SLUG);
  assert.ok(row, `expected agent slug "${AGENT_SLUG}" in ${JSON.stringify(agents.map((a) => a['slug']))}`);
  assert.equal(row!['provenance'], 'unknown', `agent must report 'unknown' — SKILL.md carries no origin field, got ${JSON.stringify(row!['provenance'])}`);
});

test('AT-1 project: GET /api/studio/projects reports provenance "unknown" for every project (Studio has no OOTB-project concept)', async () => {
  const { status, json } = await get('/api/studio/projects');
  assert.equal(status, 200, JSON.stringify(json));
  const row = findById(json['projects'], PROJECT_ID);
  assert.equal(row['provenance'], 'unknown', `project must report 'unknown' — discoverProjects is a pure directory scan, got ${JSON.stringify(row['provenance'])}`);
});

// ---------------------------------------------------------------------------
// AT-2 — the n/a-invariant. Kills: an implementation that folds "no signal"
// into the unbadged 'operator' default, silently claiming knowledge the
// server does not have.
// ---------------------------------------------------------------------------

test('AT-2 n/a-invariant: unstamped kb + agent + project report the literal "unknown" — never "operator" and never "ootb"', async () => {
  const [kbsRes, agentsRes, projectsRes] = await Promise.all([
    get('/api/studio/kbs'),
    get('/api/studio/agents'),
    get('/api/studio/projects'),
  ]);

  const unstampedKb = findById(kbsRes.json['kbs'], UNSTAMPED_KB_ID);
  assert.equal(unstampedKb['provenance'], 'unknown', 'unstamped pre-existing project brain must report "unknown"');
  assert.notEqual(unstampedKb['provenance'], 'operator', 'must NOT fold absent signal into the unbadged operator default');
  assert.notEqual(unstampedKb['provenance'], 'ootb', 'must NOT guess ootb for an unstamped kb');

  const agents = agentsRes.json['agents'] as Array<Record<string, unknown>>;
  const agentRow = agents.find((a) => a['slug'] === AGENT_SLUG)!;
  assert.equal(agentRow['provenance'], 'unknown');
  assert.notEqual(agentRow['provenance'], 'operator', 'agent has no on-disk origin signal — must not default to operator');

  const projectRow = findById(projectsRes.json['projects'], PROJECT_ID);
  assert.equal(projectRow['provenance'], 'unknown');
  assert.notEqual(projectRow['provenance'], 'operator', 'project has no OOTB concept — must not default to operator');
});

// ---------------------------------------------------------------------------
// AT-3 — one shared mapping, no forks. Kills: a second copy of the mapping
// that drifts (derive-status-dont-store-it rule 2).
// ---------------------------------------------------------------------------

// AT-3a — the pure mapping cases — moved to `packages/kernel/provenance.test.ts`
// with the module itself (QUARRY:76). They never needed the bridge this file
// boots, and a kernel module's own test belongs beside it. AT-3b/AT-3c below
// stay: their subject is that the two CONSUMERS use the shared mapping rather
// than a second copy, which is a fact about this tree, not about the mapping.

test('AT-3b: cli/bridge-studio.ts derives provenance via the shared provenanceOfOrigin — no local copy of the mapping', () => {
  const src = readFileSync(join(process.cwd(), 'cli', 'bridge-studio.ts'), 'utf8');
  assert.match(
    src,
    /provenanceOfOrigin[^;]*from ['"]@forge\/kernel['"]/s,
    'bridge-studio.ts must import the shared mapping from @forge/kernel (it moved there with QUARRY:76; the claim is unchanged — no local copy)',
  );
  assert.doesNotMatch(
    src,
    /===?\s*['"]seed['"]/,
    'bridge-studio.ts must not carry its own inline "=== \'seed\'" origin comparison — a second, driftable copy of the mapping',
  );
  assert.doesNotMatch(
    src,
    /===?\s*['"]ootb-library['"]/,
    'bridge-studio.ts must not carry its own inline "=== \'ootb-library\'" origin comparison',
  );
});

test('AT-3c: cli/bridge-studio-kbs.ts derives provenance via the shared provenanceOfOrigin — no local copy of the mapping', () => {
  const src = readFileSync(join(process.cwd(), 'packages', 'knowledge', 'bridge-studio-kbs.ts'), 'utf8');
  assert.match(
    src,
    /provenanceOfOrigin[^;]*from ['"]@forge\/kernel['"]/s,
    'bridge-studio-kbs.ts must import the shared mapping from @forge/kernel — reaching into cli/ for it was the package-to-legacy row this move closed',
  );
  assert.doesNotMatch(
    src,
    /===?\s*['"]seed['"]/,
    'bridge-studio-kbs.ts must not carry its own inline "=== \'seed\'" origin comparison — a second, driftable copy of the mapping',
  );
  assert.doesNotMatch(
    src,
    /===?\s*['"]ootb-library['"]/,
    'bridge-studio-kbs.ts must not carry its own inline "=== \'ootb-library\'" origin comparison',
  );
});

// ---------------------------------------------------------------------------
// AT-4 — derived per request, never stored. Kills: an implementation that
// "helpfully" stamps origin onto existing kb.yaml files during a READ.
// ---------------------------------------------------------------------------

/** Recursively snapshot every file's path + mtimeMs + byte length under `dir`. */
function snapshotTree(dir: string): Map<string, { mtimeMs: number; size: number }> {
  const out = new Map<string, { mtimeMs: number; size: number }>();
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile()) {
        const st = statSync(p);
        out.set(p, { mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  };
  walk(dir);
  return out;
}

test('AT-4: hitting all four list routes derives provenance per-request and writes NOTHING to disk', async () => {
  const kbYamlBefore = readFileSync(join(forgeRoot, 'brain', OOTB_KB_ID, 'kb.yaml'), 'utf8');
  const before = snapshotTree(forgeRoot);

  const [flows, agents, projects, kbs] = await Promise.all([
    get('/api/studio/flows'),
    get('/api/studio/agents'),
    get('/api/studio/projects'),
    get('/api/studio/kbs'),
  ]);

  // Precondition: "derived per request" presupposes the field is actually
  // there — a route that returns nothing has derived nothing.
  for (const [label, res, key] of [
    ['flows', flows, 'flows'],
    ['agents', agents, 'agents'],
    ['projects', projects, 'projects'],
    ['kbs', kbs, 'kbs'],
  ] as const) {
    const rows = res.json[key] as Array<Record<string, unknown>>;
    assert.ok(rows.length > 0, `${label} fixture must be non-empty`);
    for (const row of rows) {
      assert.equal(
        typeof row['provenance'],
        'string',
        `every ${label} descriptor must carry a string provenance field, got ${JSON.stringify(row['provenance'])} on id/slug ${JSON.stringify(row['id'] ?? row['slug'])}`,
      );
    }
  }

  const kbYamlAfter = readFileSync(join(forgeRoot, 'brain', OOTB_KB_ID, 'kb.yaml'), 'utf8');
  assert.equal(kbYamlAfter, kbYamlBefore, 'kb.yaml bytes must be untouched by a READ');

  const after = snapshotTree(forgeRoot);
  assert.deepEqual(
    [...after.entries()].sort(),
    [...before.entries()].sort(),
    'the fixture file tree (paths + mtimes + sizes) must be byte-for-byte identical after four READ-only list routes',
  );
});

// ---------------------------------------------------------------------------
// AT-5 — the create path really stamps. Kills: a stamp applied only in
// memory (evaporates on restart), and a stamp of 'seed' (letting an
// operator-created KB claim OOTB).
// ---------------------------------------------------------------------------

test('AT-5: POST /api/studio/kbs writes origin:studio into the new kb.yaml on disk, and a subsequent list reports "operator"', async () => {
  const newId = 'created-via-post';
  const { status, json } = await post('/api/studio/kbs', {
    id: newId,
    name: 'Created via POST',
    desc: 'AT-5 create-path fixture.',
    binding: { kind: 'unique' },
  });
  assert.equal(status, 200, JSON.stringify(json));

  const kbYamlPath = join(forgeRoot, 'brain', newId, 'kb.yaml');
  const bytes = readFileSync(kbYamlPath, 'utf8');
  assert.match(
    bytes,
    /origin:\s*studio\b/,
    `newly-created kb.yaml must contain "origin: studio" on disk, got:\n${bytes}`,
  );
  assert.doesNotMatch(bytes, /origin:\s*seed\b/, 'a create must never stamp "seed" — that would let an operator-created KB claim OOTB');

  const { json: listJson } = await get('/api/studio/kbs');
  const row = findById(listJson['kbs'], newId);
  assert.equal(row['provenance'], 'operator', `newly-created kb must list as 'operator', got ${JSON.stringify(row['provenance'])}`);
});

// ---------------------------------------------------------------------------
// AT-6 — round-trip preservation. Kills: a serializer that drops the field
// (silently downgrading an OOTB brain to unknown) or that defaults it in.
// ---------------------------------------------------------------------------

// AT-6 — the KB descriptor origin round-trip — moved to
// `packages/knowledge/tests/unit/kb-descriptor.test.ts`, beside the two
// functions it exercises. It never touched the bridge this file boots, and it
// was the whole reason a `cli/` test imported `@forge/knowledge` at all.

test('AT-7: brain/cycles/kb.yaml and brain/forge-dev/kb.yaml (the two shipped OOTB brains) carry origin: seed', () => {
  const cyclesKb = readFileSync(join(process.cwd(), 'brain', 'cycles', 'kb.yaml'), 'utf8');
  const forgeDevKb = readFileSync(join(process.cwd(), 'brain', 'forge-dev', 'kb.yaml'), 'utf8');
  assert.match(cyclesKb, /origin:\s*seed\b/, `brain/cycles/kb.yaml must contain "origin: seed", got:\n${cyclesKb}`);
  assert.match(forgeDevKb, /origin:\s*seed\b/, `brain/forge-dev/kb.yaml must contain "origin: seed", got:\n${forgeDevKb}`);
});

// ---------------------------------------------------------------------------
// AT-8 through AT-11 — forge-3oq review round. The four list routes above
// (AT-1 through AT-7) all got `provenance`, but there are SECOND construction
// sites for the same descriptors that were left out: GET /api/studio/kbs/:id
// (cli/bridge-studio-kbs.ts) builds its own `kbPublic` straight off
// `loadKbDescriptors`'s raw result with no `provenanceOfOrigin` call, and
// GET /api/studio/flows/:id (cli/bridge-studio.ts) returns
// `loadFlowDefinition(...)` directly. Reproduced against commit `aeef037f`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AT-8 — the KB DETAIL route carries provenance. Kills: a fix applied only
// at the list route, leaving GET /api/studio/kbs/:id's separately
// constructed `kbPublic` silently missing the field.
// ---------------------------------------------------------------------------

test('AT-8: GET /api/studio/kbs/:id reports the same honest provenance as the list route (seed->ootb, studio->operator, unstamped->unknown)', async () => {
  const [ootbRes, operatorRes, unstampedRes] = await Promise.all([
    get(`/api/studio/kbs/${OOTB_KB_ID}`),
    get(`/api/studio/kbs/${OPERATOR_KB_ID}`),
    get(`/api/studio/kbs/${UNSTAMPED_KB_ID}`),
  ]);
  assert.equal(ootbRes.status, 200, JSON.stringify(ootbRes.json));
  assert.equal(operatorRes.status, 200, JSON.stringify(operatorRes.json));
  assert.equal(unstampedRes.status, 200, JSON.stringify(unstampedRes.json));

  const ootbKb = ootbRes.json['kb'] as Record<string, unknown>;
  const operatorKb = operatorRes.json['kb'] as Record<string, unknown>;
  const unstampedKb = unstampedRes.json['kb'] as Record<string, unknown>;

  assert.equal(ootbKb['provenance'], 'ootb', `origin:seed kb detail must report 'ootb', got ${JSON.stringify(ootbKb['provenance'])}`);
  assert.equal(operatorKb['provenance'], 'operator', `origin:studio kb detail must report 'operator', got ${JSON.stringify(operatorKb['provenance'])}`);
  assert.equal(unstampedKb['provenance'], 'unknown', `unstamped kb detail must report 'unknown', got ${JSON.stringify(unstampedKb['provenance'])}`);
});

// ---------------------------------------------------------------------------
// AT-9 — list and detail AGREE. Kills: two independent attachments that can
// drift (a fix hand-applied at both routes separately, or fixed at one and
// forgotten at the other).
// ---------------------------------------------------------------------------

test('AT-9: list and detail AGREE on provenance for every fixture kb — no second, driftable attachment', async () => {
  const { json: listJson } = await get('/api/studio/kbs');
  const listRows = listJson['kbs'] as Array<Record<string, unknown>>;

  for (const id of [OOTB_KB_ID, OPERATOR_KB_ID, UNSTAMPED_KB_ID]) {
    const listRow = findById(listRows, id);
    const { json: detailJson } = await get(`/api/studio/kbs/${id}`);
    const detailKb = detailJson['kb'] as Record<string, unknown>;
    assert.equal(
      detailKb['provenance'],
      listRow['provenance'],
      `kb "${id}": list reports ${JSON.stringify(listRow['provenance'])} but detail reports ${JSON.stringify(detailKb['provenance'])} — two independent attachments have drifted`,
    );
  }
});

// ---------------------------------------------------------------------------
// AT-10 — the loader is the single attachment point (structural). Asserts at
// the SOURCE level, house precedent: cli/kb-lint-summary.test.ts's AT-4a/
// AT-4b use the exact same comment-stripping + brace-depth function-body
// extraction to prove a call site lives inside a specific function. Kills: a
// future route layered over `loadKbDescriptors` forgetting the field, by
// requiring the ONE attachment point be the loader itself, not any one
// caller of it.
// ---------------------------------------------------------------------------

/** Strips block + line comments so a doc comment mentioning
 *  `provenanceOfOrigin(` in prose can't masquerade as a real call site, and
 *  can't corrupt brace-depth counting below. Mirrors
 *  cli/kb-lint-summary.test.ts's `stripComments` — same technique,
 *  duplicated locally rather than imported across test files. */
function stripCommentsForCallSiteCheck(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Extract a `function <fnName>` declaration's BODY.
 *
 * REWRITTEN IN M4 PR 4b, because the previous implementation was wrong and its
 * own doc comment said otherwise. It claimed to mirror
 * `packages/knowledge/kb-lint-summary.test.ts`'s `extractFunctionBody`; in fact
 * it took the LAST top-level brace block between the signature and the next
 * `\nexport `, which is the target's body only while no NON-EXPORTED function
 * happens to follow it. When PR 4b moved `newProjectBrainSessionId` to sit
 * between `loadKbDescriptors` and the next `export`, this returned THAT
 * function's body and AT-10 failed against source that was entirely correct.
 *
 * The failure was loud, which is the lucky half. The same swap in the other
 * direction is silent: had the neighbour contained a `provenanceOfOrigin(`
 * call, AT-10 would have passed while asserting nothing about the loader.
 *
 * This is now genuinely the sibling's algorithm — walk from the signature,
 * tracking `(`/`<`/`[` so a parameter list or generic cannot be mistaken for
 * the body, take the first `{` at depth zero, then brace-match it.
 */
function extractFunctionBodyForCallSiteCheck(src: string, fnName: string, fileLabel: string): string {
  const sigIdx = src.indexOf(`function ${fnName}`);
  assert.ok(sigIdx >= 0, `expected a "function ${fnName}" declaration in ${fileLabel}`);

  const closerFor: Record<string, string> = { '(': ')', '<': '>', '[': ']' };
  const stack: string[] = [];
  let bodyStart = -1;
  for (let i = sigIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch in closerFor) stack.push(closerFor[ch]);
    else if (stack.length > 0 && ch === stack[stack.length - 1]) stack.pop();
    else if (ch === '{' && stack.length === 0) { bodyStart = i; break; }
  }
  assert.ok(bodyStart >= 0, `could not locate the opening { for ${fnName} in ${fileLabel}`);

  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, j + 1);
    }
  }
  assert.fail(`unbalanced braces in ${fnName} (${fileLabel})`);
}

test('AT-10: packages/knowledge/bridge-studio-kbs.ts contains exactly ONE provenanceOfOrigin( call site, and it lives inside loadKbDescriptors — so no route built over the loader can forget the field', () => {
  const filePath = join(process.cwd(), 'packages', 'knowledge', 'bridge-studio-kbs.ts');
  const src = stripCommentsForCallSiteCheck(readFileSync(filePath, 'utf8'));

  const callSites = src.match(/\bprovenanceOfOrigin\s*\(/g) ?? [];
  assert.equal(
    callSites.length,
    1,
    `expected exactly ONE provenanceOfOrigin( call site in packages/knowledge/bridge-studio-kbs.ts (the single attachment point every route inherits), found ${callSites.length}`,
  );

  const loaderBody = extractFunctionBodyForCallSiteCheck(src, 'loadKbDescriptors', 'packages/knowledge/bridge-studio-kbs.ts');
  assert.ok(
    /\bprovenanceOfOrigin\s*\(/.test(loaderBody),
    'provenanceOfOrigin( must be called INSIDE loadKbDescriptors — a call site anywhere else (e.g. only in the list route handler) means every OTHER caller of loadKbDescriptors (detail, resolve-node, delete, guidance) silently misses the field',
  );
});

// ---------------------------------------------------------------------------
// AT-11 — the FLOW detail route carries provenance. Kills: the same
// list-only fix on the flow side — GET /api/studio/flows/:id returns
// loadFlowDefinition(...) directly, with no provenance attached.
// ---------------------------------------------------------------------------

test('AT-11: GET /api/studio/flows/:id reports provenance derived from the REAL origin field (seed->ootb, studio->operator)', async () => {
  const [ootbRes, operatorRes] = await Promise.all([
    get(`/api/studio/flows/${OOTB_FLOW_ID}`),
    get(`/api/studio/flows/${OPERATOR_FLOW_ID}`),
  ]);
  assert.equal(ootbRes.status, 200, JSON.stringify(ootbRes.json));
  assert.equal(operatorRes.status, 200, JSON.stringify(operatorRes.json));

  const ootbFlow = ootbRes.json['flow'] as Record<string, unknown>;
  const operatorFlow = operatorRes.json['flow'] as Record<string, unknown>;

  assert.equal(ootbFlow['origin'], 'seed');
  assert.equal(operatorFlow['origin'], 'studio');
  assert.equal(ootbFlow['provenance'], 'ootb', `origin:seed flow detail must report 'ootb', got ${JSON.stringify(ootbFlow['provenance'])}`);
  assert.equal(operatorFlow['provenance'], 'operator', `origin:studio flow detail must report 'operator', got ${JSON.stringify(operatorFlow['provenance'])}`);
});
