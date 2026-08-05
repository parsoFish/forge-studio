/**
 * ACCEPTANCE TESTS (must be RED until fixed) — guard-symmetry defect (Defect
 * 3): sibling routes that SLUG_RE-gate their id and then use a bare
 * `join()`/lexical `startsWith` where an already-fixed sibling route in the
 * SAME file uses `resolveGuardedPath` (cli/studio-path-guard.ts). Each of the
 * routes below is a dir-symlink escape driven through the REAL bridge
 * (`startBridge`), mirroring the fixture idiom of
 * cli/bridge-studio-write.test.ts / cli/bridge-studio-flows.test.ts.
 *
 *   - GET  /api/studio/flows/:id                — cli/bridge-studio.ts ~L618
 *     (lexical `resolve(flowsBase,id,'flow.yaml').startsWith(flowsBase+sep)`
 *     on an UNRESOLVED path). Its PUT sibling (cli/bridge-studio-writes.ts)
 *     IS guarded via resolveGuardedPath — this GET route was never updated.
 *   - GET  /api/studio/skills/:id                — cli/bridge-studio-skills.ts
 *     ~L263 (`skillPath(id, forgeRoot)` — orchestrator/skill-path.ts's
 *     `assertSkillSlug` + a bare `join()`, no realpath identity check at all).
 *   - POST /api/studio/skills/:id/approve        — same file ~L224, same
 *     `skillPath()` call. The POST-create sibling (`POST /api/studio/skills`)
 *     IS guarded via resolveGuardedPath.
 *   - POST /api/studio/hooks                     — cli/bridge-studio-hooks.ts
 *     ~L239 (`hookDir(slug, forgeRoot)` — orchestrator/studio/hook-library.ts's
 *     `assertSkillSlug` + bare `join()`).
 *   - POST /api/studio/hooks/:id/approve         — ~L278 (`hookYamlPath`).
 *   - GET  /api/studio/hooks/:id                 — ~L341-343 (`hookDir` +
 *     `hookYamlPath`).
 *
 * For each GET/detail route the assertion is "the outside/other-object secret
 * content is NOT in the response body". For the write route (POST
 * /api/studio/hooks — a CREATE, so the escape is a symlinked `id` dir that
 * already exists pointing elsewhere) the assertion is "the outside file's
 * bytes are unchanged" / "nothing is created outside".
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { readHookApprovalLedger } from '../orchestrator/studio/hook-scan.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

/** Minimal valid flow.yaml (satisfies loadFlowDefinition's required fields). */
function makeFlowYaml(id: string, project: string | null = null): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1',
    'goal: g',
    `project: ${project ?? 'null'}`,
    'kb: null',
    'costCeilingUsd: 2',
    'origin: studio',
    'nodes:',
    '  - id: n',
    '    gate: human',
    'edges: []',
    'triggers: []',
  ].join('\n');
}

/** Minimal composable-skill SKILL.md (no runtime block — a plain library skill). */
function makePlainSkillMd(name: string, secretMarker: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${secretMarker}`,
    'library: true',
    '---',
    '',
    `# ${name}`,
    '',
    `${secretMarker}`,
  ].join('\n');
}

/** Minimal valid hook.yaml (matches orchestrator/studio/hook-library.ts's HookDefinition shape). */
function makeHookYaml(secretMarker: string): string {
  return [
    'name: Test Hook',
    `description: ${secretMarker}`,
    'on: SessionEnd',
    'script: scripts/run.sh',
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n');
}

before(async () => {
  forgeRoot = tmp('bridge-sibling-containment-');

  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });

  // ---- GET /api/studio/flows/:id — studio/flows/escape-flow -> outside ----
  const flowsOutside = newOutsideDir('sibling-flows-outside-');
  writeFileSync(join(flowsOutside, 'flow.yaml'), makeFlowYaml('outside-flow', 'SECRET-MARKER-FLOWGET-a11c3'));
  try {
    symlinkSync(flowsOutside, join(forgeRoot, 'studio', 'flows', 'escape-flow'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- GET /api/studio/skills/:id — skills/escape-skill -> outside --------
  const skillsOutside = newOutsideDir('sibling-skills-outside-');
  writeFileSync(join(skillsOutside, 'SKILL.md'), makePlainSkillMd('Outside Skill', 'SECRET-MARKER-SKILLGET-7cd21'));
  try {
    symlinkSync(skillsOutside, join(forgeRoot, 'skills', 'escape-skill'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- POST /api/studio/skills/:id/approve — skills/escape-skill-draft ----
  // A DRAFT package (status: draft in frontmatter) so skillTrustDetail
  // resolves 'draft' and the route proceeds to approveSkillDraft's WRITE —
  // approve does not consult listSkillLibrary at all (unlike GET-detail), so
  // the dirent-filter accident that protects GET-detail does not apply here.
  const skillsDraftOutside = newOutsideDir('sibling-skills-draft-outside-');
  writeFileSync(
    join(skillsDraftOutside, 'SKILL.md'),
    ['---', 'name: Outside Draft Skill', 'description: outside draft skill', 'status: draft', '---', '', '# Outside Draft Skill', '', 'Body.'].join('\n'),
  );
  try {
    symlinkSync(skillsDraftOutside, join(forgeRoot, 'skills', 'escape-skill-draft'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- POST /api/studio/hooks (create) — hooks/escape-hook -> outside -----
  // A dir-symlink escape on a CREATE route only bites when the id already
  // resolves to an existing directory the route would otherwise treat as
  // "already exists" or write into — plant it pointing at an outside dir
  // that does NOT yet have a hook.yaml, so the create path's existsSync
  // check is exercised (route creates scripts/run.sh + hook.yaml through it).
  const hooksCreateOutside = newOutsideDir('sibling-hooks-create-outside-');
  try {
    symlinkSync(hooksCreateOutside, join(forgeRoot, 'studio', 'hooks', 'escape-hook-create'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  // ---- GET /api/studio/hooks/:id + POST approve — hooks/escape-hook -------
  const hooksReadOutside = newOutsideDir('sibling-hooks-read-outside-');
  mkdirSync(join(hooksReadOutside, 'scripts'), { recursive: true });
  writeFileSync(join(hooksReadOutside, 'hook.yaml'), makeHookYaml('SECRET-MARKER-HOOKGET-9de44'));
  writeFileSync(join(hooksReadOutside, 'scripts', 'run.sh'), '#!/bin/sh\necho SECRET-MARKER-HOOKSCRIPT-2b6f0\n');
  try {
    symlinkSync(hooksReadOutside, join(forgeRoot, 'studio', 'hooks', 'escape-hook-read'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

async function get(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return { status: res.status, text: await res.text() };
}

async function post(path: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET /api/studio/flows/:id
// ---------------------------------------------------------------------------

test('FIXED (amendment round): GET /api/studio/flows/escape-flow no longer leaks — the guard rejection is byte-identical to a genuinely unknown flow', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // cli/bridge-studio.ts's GET route now resolves through resolveGuardedPath
  // (the same shared guard its PUT sibling already used) and folds a guard
  // rejection into the SAME `{error:'unknown flow'}` 404 a genuinely absent
  // flow produces — no id is echoed in this particular error message, so the
  // two responses are expected to be BYTE-IDENTICAL, not merely
  // same-shaped. That is the real property: the route cannot be used to
  // probe which ids are planted-but-rejected vs. never-existed.
  const escaped = await get('/api/studio/flows/escape-flow');
  const neverExisted = await get('/api/studio/flows/totally-unplanted-flow-xyz');

  assert.equal(escaped.status, 404, `expected the symlinked flow dir to read as "no such flow", got ${escaped.status}: ${escaped.text}`);
  assert.ok(!escaped.text.includes('SECRET-MARKER-FLOWGET-a11c3'), `the response must NOT contain the outside flow.yaml's content — got: ${escaped.text}`);
  assert.equal(escaped.status, neverExisted.status, 'the symlinked-dir 404 must carry the SAME status as a genuinely unknown flow');
  assert.equal(escaped.text, neverExisted.text, 'the symlinked-dir 404 must be BYTE-IDENTICAL to a genuinely unknown flow — no side-channel distinguishing "escape rejected" from "never existed"');
});

// ---------------------------------------------------------------------------
// GET /api/studio/skills/:id
// ---------------------------------------------------------------------------

test('FIXED (amendment round): GET /api/studio/skills/escape-skill no longer leaks — a genuine containment guard now rejects it, indistinguishable from an unknown skill', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // SUPERSEDES the prior "accidental-pass" framing here. cli/bridge-studio-
  // skills.ts's detail route now resolves `id` through resolveGuardedPath
  // (skills/ as the fixed root, id as its own segment) BEFORE ever calling
  // isStudioAgent/skillTrustDetail/readSkillPackage — the symlinked
  // skills/escape-skill directory fails the guard's identity check outright,
  // so the route never reads the outside content at all (previously it DID
  // read it, then happened to 500 on an unrelated internal-consistency
  // check before serializing a response — that accident is gone; this is
  // now a deliberate containment pin). A guard rejection collapses into the
  // SAME `unknown skill "<id>"` 404 template a genuinely unknown skill
  // produces, so the id-echo is normalized out before comparing.
  const escapedId = 'escape-skill';
  const neverExistedId = 'totally-unplanted-skill-xyz';
  const escaped = await get(`/api/studio/skills/${escapedId}`);
  const neverExisted = await get(`/api/studio/skills/${neverExistedId}`);

  assert.equal(escaped.status, 404, `expected the symlinked skill dir to read as "no such skill", got ${escaped.status}: ${escaped.text}`);
  assert.ok(!escaped.text.includes('SECRET-MARKER-SKILLGET-7cd21'), `the response must NOT contain the outside file's content — got: ${escaped.text}`);
  assert.equal(escaped.status, neverExisted.status, 'the symlinked-dir 404 must carry the SAME status as a genuinely unknown skill');
  const normalize = (text: string, id: string): string => text.split(id).join('<id>');
  assert.equal(
    normalize(escaped.text, escapedId),
    normalize(neverExisted.text, neverExistedId),
    'the symlinked-dir 404 must carry the SAME body TEMPLATE as a genuinely unknown skill (modulo the echoed id)',
  );
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills/:id/approve
// ---------------------------------------------------------------------------

test('FIXED (amendment round; was the headline repro): POST /api/studio/skills/escape-skill-draft/approve no longer writes through the dir-symlinked skills/<id>', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // Unlike GET-detail, approve does NOT consult listSkillLibrary at all —
  // it now resolves through the SAME resolveGuardedPath fix as GET-detail
  // (skillPath()'s bare join was replaced there too), so the symlinked
  // skills/escape-skill-draft directory is rejected before
  // skillTrustDetail/approveSkillDraft ever touch it. This assertion was
  // already property-based (outside bytes unchanged), so it required no
  // change beyond the title — it was RED before the fix landed and is
  // GREEN now, which is exactly what a genuine acceptance test should do.
  const skillsDraftOutside = outsideDirs.find((d) => d.includes('sibling-skills-draft-outside-'))!;
  const outsideFile = join(skillsDraftOutside, 'SKILL.md');
  const originalBytes = readFileSync(outsideFile, 'utf8');

  const { status, text } = await post('/api/studio/skills/escape-skill-draft/approve', {});

  const afterBytes = readFileSync(outsideFile, 'utf8');
  assert.equal(
    afterBytes,
    originalBytes,
    `the outside SKILL.md must be byte-unchanged — status ${status}: ${text}. Today: skillPath()/skillDir() (orchestrator/skill-path.ts) call assertSkillSlug (shape only) then a bare join() — approveSkillDraft's writeFileSync follows the symlinked skills/<id> directory straight through to the outside file.`,
  );
});

// ---------------------------------------------------------------------------
// POST /api/studio/hooks (create) — dir-symlink escape on the create route
// ---------------------------------------------------------------------------

test('FIXED (amendment round): POST /api/studio/hooks with id "escape-hook-create" no longer writes through the dir-symlinked studio/hooks/<id>', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // The create route now resolves BOTH hook.yaml and scripts/run.sh through
  // resolveGuardedPath (studio/hooks/ as the fixed root, slug as its own
  // segment) before any mkdirSync/writeFileSync — a symlinked
  // studio/hooks/escape-hook-create directory fails the guard's identity
  // check outright and the route rejects (400) before touching the
  // filesystem at all. Asserted unconditionally, not as a branch that only
  // runs in the vulnerable state: the outside directory must gain no new
  // entries AND the route must not report success, regardless of which
  // status code the rejection uses.
  const outside = outsideDirs.find((d) => d.includes('sibling-hooks-create-outside-'))!;
  const before_ = readdirSync(outside).sort();

  const { status, text } = await post('/api/studio/hooks', {
    id: 'escape-hook-create',
    name: 'Escape Hook',
    description: 'attacker-authored hook',
    on: 'SessionEnd',
    scriptBody: '#!/bin/sh\necho pwned\n',
  });

  const after_ = readdirSync(outside).sort();
  assert.deepEqual(
    after_,
    before_,
    `nothing may be created inside the outside directory a symlinked studio/hooks/<id> points at — status ${status}: ${text}. before=${JSON.stringify(before_)} after=${JSON.stringify(after_)}`,
  );
  assert.notEqual(status, 200, `the route must not report success for a symlinked studio/hooks/<id> — got ${status}: ${text}`);
});

// ---------------------------------------------------------------------------
// GET /api/studio/hooks/:id
// ---------------------------------------------------------------------------

test('accidental-pass (regression lock, NOT a containment pin): GET /api/studio/hooks/escape-hook-read 404s — the SAME dirent-filter accident as skills/KBs', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // ACCIDENT NAMED: the route's FIRST step is `listHookLibrary(ctx.forgeRoot)
  // .find(e => e.id === id)` — listHookLibrary's underlying scan
  // (listHookIds, orchestrator/studio/hook-library.ts) does
  // `readdirSync(dir,{withFileTypes:true}).filter(e => e.isDirectory())`,
  // the SAME dirent-type filter that hides a symlinked directory ENTRY
  // (confirmed empirically) as the loadKbDescriptors/listSkillLibrary
  // accidents already documented in this campaign. "escape-hook-read" is
  // invisible to listHookLibrary, so the route 404s before ever reaching
  // hookDir()/hookYamlPath()/readFileSync (the lines the defect actually
  // names) — those lines remain genuinely unguarded (see the CREATE-route
  // test above, which reaches the equivalent bare-join code via a DIFFERENT
  // route that does not consult this listing first).
  const { status, text } = await get('/api/studio/hooks/escape-hook-read');
  assert.equal(status, 404, `expected the accidental 404, got ${status}: ${text}`);
  assert.ok(!text.includes('SECRET-MARKER-HOOKGET-9de44') && !text.includes('SECRET-MARKER-HOOKSCRIPT-2b6f0'), 'no leak either way');
});

// ---------------------------------------------------------------------------
// POST /api/studio/hooks/:id/approve
// ---------------------------------------------------------------------------

test('FIXED (amendment round; comment supersedes a stale mechanism description): POST /api/studio/hooks/escape-hook-read/approve never records an approval, and now 404s indistinguishably from an unknown hook', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // SUPERSEDES the prior "already-guarded by a different pre-existing check,
  // wrong status code" framing. Re-verified directly against the current
  // build: approve now resolves `id` through resolveGuardedPath (the SAME
  // shared guard as the create/GET-detail routes) BEFORE ever calling
  // hookRunState/loadHookDefinition — the symlinked studio/hooks/escape-
  // hook-read directory fails the guard's identity check outright and the
  // route returns the conventional `unknown hook "<id>"` 404, collapsing
  // into the SAME response a genuinely unknown hook produces. The
  // previously-observed 500 (from an unrelated script-path realpath check
  // deeper in loadHookDefinition) is no longer reached at all. The real
  // invariant — no ledger entry is ever recorded — still holds and is still
  // asserted directly, not inferred from a status code.
  const ledgerBefore = readHookApprovalLedger(forgeRoot).has('escape-hook-read');
  assert.equal(ledgerBefore, false, 'sanity: no pre-existing ledger entry');

  const escapedId = 'escape-hook-read';
  const neverExistedId = 'totally-unplanted-hook-xyz';
  const escaped = await post(`/api/studio/hooks/${escapedId}/approve`, {});
  const neverExisted = await post(`/api/studio/hooks/${neverExistedId}/approve`, {});

  assert.equal(escaped.status, 404, `expected the symlinked hook dir to read as "no such hook", got ${escaped.status}: ${escaped.text}`);
  assert.equal(escaped.status, neverExisted.status, 'the symlinked-dir 404 must carry the SAME status as a genuinely unknown hook');
  const normalize = (text: string, id: string): string => text.split(id).join('<id>');
  assert.equal(
    normalize(escaped.text, escapedId),
    normalize(neverExisted.text, neverExistedId),
    'the symlinked-dir 404 must carry the SAME body TEMPLATE as a genuinely unknown hook (modulo the echoed id)',
  );

  const ledgerAfter = readHookApprovalLedger(forgeRoot).has('escape-hook-read');
  assert.equal(ledgerAfter, false, `no approval-ledger entry may be recorded for "escape-hook-read" — got status ${escaped.status}: ${escaped.text}`);
});

// ---------------------------------------------------------------------------
// Non-regression: an ordinary, non-symlinked hook/skill/flow still resolves
// fine through these same routes (the guard-symmetry fix must not break the
// happy path).
// ---------------------------------------------------------------------------

test('non-regression: an ordinary real flow still GETs fine (no symlink involved)', async () => {
  mkdirSync(join(forgeRoot, 'studio', 'flows', 'plain-flow'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'flows', 'plain-flow', 'flow.yaml'), makeFlowYaml('plain-flow'));
  const { status, text } = await get('/api/studio/flows/plain-flow');
  assert.equal(status, 200, text);
});
