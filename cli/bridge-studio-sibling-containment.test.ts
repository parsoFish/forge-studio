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
import { readHookApprovalLedger } from '@forge/library/studio/hook-scan.ts';

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

// ---------------------------------------------------------------------------
// ROUND 3 (2026-08-06, guard-attack round, Finding 3, MINOR, functional
// regression introduced by the containment fix): GET /api/studio/hooks/:id
// 404s a perfectly valid hook whose `script:` is "scripts//run.sh" (double
// slash).
//
// cli/bridge-studio-hooks.ts:375 —
//   resolveGuardedPath(hooksDir(forgeRoot), [id, ...entry.script.split('/')])
// A hook.yaml declaring `script: "scripts//run.sh"` loads FINE everywhere
// else: `loadHookDefinition`'s own `resolveHookScriptPath`
// (orchestrator/studio/hook-library.ts) resolves it via `path.resolve()`,
// which silently collapses the double slash, so `entry.ok === true`, the
// LIST route (which never calls resolveGuardedPath at all) reports it
// correctly, and `scanHookPackage`/`hookRunState` (which read the script via
// a plain `path.join()`, ALSO collapsing the double slash) score it `clean`.
// But `entry.script.split('/')` on `"scripts//run.sh"` yields `['scripts',
// '', 'run.sh']` — the middle EMPTY segment fails `isSafeSegment` (its first
// check is `seg.length > 0`), so the detail route's OWN guard rejects an
// object every other code path already treats as valid, and 404s it.
//
// Every fixture below is planted directly under the shared `forgeRoot` — no
// separate cleanup is needed, since the whole forgeRoot is removed by this
// file's `after()` — and each uses a unique id so it cannot collide with any
// other test in this file.
// ---------------------------------------------------------------------------

function plantDoubleSlashHook(root: string, id: string, marker: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'hook.yaml'), [
    `name: ${id}`,
    'description: exercises a double-slash script path',
    'on: SessionEnd',
    'script: scripts//run.sh',
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n'));
  writeFileSync(join(dir, 'scripts', 'run.sh'), `#!/bin/sh\necho ${marker}\n`);
}

test('non-regression [Finding 3]: a hook with a double-slash script path ("scripts//run.sh") is ok:true and scans clean in the LIST route', async () => {
  plantDoubleSlashHook(forgeRoot, 'dblslash-hook-list', 'DBLSLASH-HOOK-LIST-MARKER-4e1a9');

  const { status, text } = await get('/api/studio/hooks');
  assert.equal(status, 200, `expected 200, got ${status}: ${text}`);
  const body = JSON.parse(text) as { hooks: Array<{ id: string; ok: boolean; scanVerdict?: string }> };
  const entry = body.hooks.find((h) => h.id === 'dblslash-hook-list');
  assert.ok(entry, `expected "dblslash-hook-list" to appear in the list — got ids: ${body.hooks.map((h) => h.id).join(', ')}`);
  assert.equal(entry!.ok, true, `expected the double-slash hook to load fine in the LIST route (loadHookDefinition tolerates it via path.resolve normalization) — got ${JSON.stringify(entry)}`);
  assert.equal(entry!.scanVerdict, 'clean', `expected a benign echo script to scan clean — got ${JSON.stringify(entry)}`);
});

test('(RED) [Finding 3]: GET /api/studio/hooks/:id 404s a valid hook whose script path is "scripts//run.sh" (double slash)', async () => {
  plantDoubleSlashHook(forgeRoot, 'dblslash-hook-detail', 'DBLSLASH-HOOK-DETAIL-MARKER-71cd0');

  const { status, text } = await get('/api/studio/hooks/dblslash-hook-detail');
  assert.equal(
    status,
    200,
    `expected the detail route to load this ALREADY-VALID hook (ok:true + scanVerdict clean in the list route, proven by the sibling test above) — got ${status}: ${text}. entry.script.split('/') on "scripts//run.sh" produces an EMPTY middle segment that fails isSafeSegment (length===0), so resolveGuardedPath rejects a path that was never actually unsafe — the empty segment normalizes away harmlessly under plain path.resolve()/path.join(), exactly how resolveHookScriptPath (hook-library.ts) and hookRunState's own script read already tolerate it.`,
  );
  // W8-F2 amendment (claim unchanged, spelling updated). This assertion used
  // to look for a files[] entry whose path was the DECLARED string
  // "scripts//run.sh", because the route hand-built its file list as
  // `{path: entry.script}` — it echoed the manifest. The route now serves
  // `readHookPackage`, i.e. what is actually ON DISK, so the entry is spelled
  // "scripts/run.sh". That is the improvement, not a regression: files[] is
  // what the operator approves, and echoing a doubled slash as though it were
  // a real filename would be describing a file that does not exist. The
  // load-bearing claims of this test — 200 not 404, and the REAL script body
  // is returned — are asserted exactly as before.
  const detail = JSON.parse(text) as { files?: Array<{ path: string; body: string }> };
  const scriptFile = detail.files?.find((f) => f.path === 'scripts/run.sh');
  assert.ok(scriptFile, `expected a files[] entry for the on-disk script path "scripts/run.sh" (the route reports DISK, not the manifest's "scripts//run.sh" spelling) — got ${text}`);
  assert.ok(
    scriptFile!.body.includes('DBLSLASH-HOOK-DETAIL-MARKER-71cd0'),
    `expected the detail route to return the real script body — got ${text}`,
  );
  assert.ok(
    !detail.files?.some((f) => f.path === 'scripts//run.sh'),
    `files[] must describe the package as it exists on disk, never echo the manifest's declared spelling — got ${text}`,
  );
});

test('security companion [Finding 3]: a hook with a ".."-escaping script path is STILL rejected — the double-slash fix must normalise away only empty/"." segments, never ".."', async () => {
  const dir = join(forgeRoot, 'studio', 'hooks', 'traversal-hook');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hook.yaml'), [
    'name: traversal-hook',
    'description: attempts to escape via a ".."-bearing script path',
    'on: SessionEnd',
    'script: ../../../etc/passwd',
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n'));

  const { status, text } = await get('/api/studio/hooks/traversal-hook');
  assert.equal(
    status,
    404,
    `a ".."-escaping script path must NEVER be served — got ${status}: ${text}. Whether caught by loadHookDefinition's own boundary check (resolveHookScriptPath, which is why this hook is ok:false in the list route today) or by a future change to the bridge's resolveGuardedPath call, a fix for the double-slash defect must not loosen this by e.g. blanket-filtering every falsy/short segment instead of specifically excluding empty and "." segments.`,
  );
  assert.ok(!text.includes('root:'), 'sanity: no /etc/passwd-shaped content ever appears in the response');
});

test('security companion [Finding 3]: a hook script path that re-enters a DIFFERENT sibling hook via "nonexistent/../../other-hook/hook.yaml" is STILL rejected', async () => {
  // Plant the sibling target first so a wrongly-permissive fix would have a
  // real file to actually read through.
  const otherDir = join(forgeRoot, 'studio', 'hooks', 'other-hook');
  mkdirSync(join(otherDir, 'scripts'), { recursive: true });
  writeFileSync(join(otherDir, 'hook.yaml'), [
    'name: other-hook',
    'description: SECRET-MARKER-OTHERHOOK-3d81c — must never be read through the traversal hook',
    'on: SessionEnd',
    'script: scripts/run.sh',
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n'));
  writeFileSync(join(otherDir, 'scripts', 'run.sh'), '#!/bin/sh\necho other-hook\n');

  const dir = join(forgeRoot, 'studio', 'hooks', 'cross-hook-traversal');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hook.yaml'), [
    'name: cross-hook-traversal',
    'description: attempts to re-enter a sibling hook dir via nested ".."',
    'on: SessionEnd',
    'script: nonexistent/../../other-hook/hook.yaml',
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n'));

  const { status, text } = await get('/api/studio/hooks/cross-hook-traversal');
  assert.equal(status, 404, `a cross-sibling ".."-escaping script path must be rejected — got ${status}: ${text}`);
  assert.ok(!text.includes('SECRET-MARKER-OTHERHOOK-3d81c'), `the response must NOT contain the other hook's description — got: ${text}`);
});

// ---------------------------------------------------------------------------
// ROUND 4 (2026-08-06, test-writer T3): two findings from the adversarial
// review that need red ATs before the fix. NEITHER is a content-disclosure
// escape — `loadHookDefinition` already validates `def.script` through
// `resolveHookScriptPath` (orchestrator/studio/hook-library.ts — lexical +
// percent-decoded + conditional-realpath), so a script that genuinely
// escapes the hook dir is rejected AT LOAD, before any read. What is NOT
// closed is what happens on the THROW path once a script path resolves
// INSIDE the hook dir at load time but faults at read time (Finding A), or
// once a load-time throw happens inside a route that already 404s the same
// fixture on ITS sibling GET route (Finding B).
// ---------------------------------------------------------------------------

// ---- FINDING A: one malformed hook blanks the ENTIRE library list ---------
//
// cli/bridge-studio-hooks.ts:191 —
//   listHookLibrary(forgeRoot).map(entry => toClientListEntry(forgeRoot, entry))
// `toClientListEntry` (same file, ~L119) calls `hookRunState(forgeRoot,
// entry.id)` with NO per-entry try/catch. `hookRunState` -> `scanHookPackage`
// -> `readHookScriptBody` (orchestrator/studio/hook-scan.ts:364-367) ->
// `readFileSync(join(hookDir(id, forgeRoot), def.script))`.
//
// `listHookLibrary` itself ALREADY isolates a per-id LOAD failure (a hook
// whose script escapes the boundary at load time degrades to `ok:false` +
// `error`, never crashing the whole scan — see `loadHookDefinition`'s own
// try/catch inside `listHookLibrary`). But the bridge route throws that
// isolation away: a hook whose `script:` field resolves INSIDE the hook dir
// at LOAD time (so `resolveHookScriptPath` is satisfied, `entry.ok ===
// true`) and then throws at `readFileSync` time is not caught anywhere on
// this path. `Array.prototype.map` propagates that ONE entry's throw out of
// the WHOLE call, landing in the route's outer catch -> 500 for every hook
// in the library, not just the malformed one.
//
// Three variants, EACH confirmed empirically (via a standalone script
// exercising the real `loadHookDefinition`/`hookRunState` against a real
// fixture, before this test was written) to satisfy both halves —
// `resolveHookScriptPath` tolerates the path at load time (`entry.ok ===
// true`), but the SEPARATE `path.join()` + `readFileSync` in
// `readHookScriptBody` throws:
//   1. `scripts/.` — `path.join` collapses the trailing "/." to the
//      "scripts" DIRECTORY itself -> `readFileSync` throws EISDIR. (At load
//      time, `resolveHookScriptPath` uses `path.resolve`, which ALSO
//      collapses "/." the same way, and the resulting "scripts" dir exists
//      — no symlink involved — so load-time never throws.)
//   2. `scripts/run.sh/` (trailing slash) — AS ORIGINALLY WRITTEN (pre-fix):
//      `path.resolve` (load time) strips the trailing slash, sees the real
//      file, passes; `path.join` (read time) PRESERVES the trailing slash,
//      so `readFileSync` opened ".../run.sh/" against a REGULAR FILE ->
//      ENOTDIR. AMENDED post-fix (T2 round, 2026-08-06): `readHookScriptBody`
//      no longer uses a bare `path.join` — it now splits `script` into guard
//      segments and drops empty/"." components, the SAME rule the
//      double-slash fix (Finding 3) already applies, because `path.resolve`
//      tolerates them everywhere else and rejecting them here would 404 a
//      valid hook. `"scripts/run.sh/".split('/')` is `['scripts','run.sh','']`
//      — the trailing empty component is dropped by that same rule, landing
//      on the REAL file with no trailing slash. So this variant no longer
//      throws at read time either: it is now genuinely valid and functional,
//      not merely non-crashing. See the variant 2/3 test below, which now
//      asserts the STRONGER, still-true property (element fault never
//      becomes collection failure) rather than the old degradation.
//   3. `scripts\run.sh` (ONE literal backslash character — Linux has no
//      concept of "\" as a path separator, so this is a single filename
//      component, never split into "scripts" + "run.sh" the way a real "/"
//      would) — resolves to a path that does not exist (there IS no file
//      literally named "scripts\run.sh") -> ENOENT. Load time never throws
//      either, because `resolveHookScriptPath` only runs its realpath/
//      symlink check when the resolved path `existsSync` — and this one
//      doesn't exist, so it silently returns the (non-existent) resolved
//      path without complaint.
//
// For each variant the malformed hook is planted ALONGSIDE two genuinely
// valid hooks — the point of the test is that THOSE survive, not merely that
// the malformed one is flagged.
// ---------------------------------------------------------------------------

function plantValidHook(root: string, id: string, marker: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'hook.yaml'), [
    `name: ${id}`,
    `description: ${marker}`,
    'on: SessionEnd',
    'script: scripts/run.sh',
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n'));
  writeFileSync(join(dir, 'scripts', 'run.sh'), `#!/bin/sh\necho ${marker}\n`);
}

/** Plants a hook whose `script:` field is exactly `scriptField` — YAML-quoted
 *  via `JSON.stringify` so a literal backslash round-trips as exactly one
 *  backslash character (JSON's string-escaping rules are a strict subset of
 *  YAML's double-quoted-scalar escaping; confirmed by reading the written
 *  file back through js-yaml before this test was written). Passes
 *  `resolveHookScriptPath` (load time) but faults inside `readHookScriptBody`
 *  (read time) — see the three variants above. */
function plantScriptPathFaultHook(root: string, id: string, scriptField: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'hook.yaml'), [
    `name: ${id}`,
    'description: script path resolves inside the hook dir at load time but faults at read time',
    'on: SessionEnd',
    `script: ${JSON.stringify(scriptField)}`,
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n'));
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/bin/sh\necho benign\n');
}

interface HooksListEntry {
  id: string;
  ok: boolean;
  name?: string;
  on?: string;
  scanVerdict?: string;
  runnable?: boolean;
  error?: string;
}

function assertValidHookEntrySurvives(hooks: HooksListEntry[], id: string, context: string): void {
  const entry = hooks.find((h) => h.id === id);
  assert.ok(entry, `${context}: expected valid hook "${id}" to still be present in the list — got ids: ${hooks.map((h) => h.id).join(', ')}`);
  assert.equal(entry!.ok, true, `${context}: expected valid hook "${id}" to still load ok:true — got ${JSON.stringify(entry)}`);
  assert.equal(entry!.name, id, `${context}: expected valid hook "${id}"'s name field intact — got ${JSON.stringify(entry)}`);
  assert.equal(entry!.on, 'SessionEnd', `${context}: expected valid hook "${id}"'s on field intact — got ${JSON.stringify(entry)}`);
  assert.equal(entry!.scanVerdict, 'clean', `${context}: expected valid hook "${id}" to scan clean (a benign echo script) — got ${JSON.stringify(entry)}`);
  assert.equal(entry!.runnable, false, `${context}: expected valid hook "${id}" runnable:false (not yet approved) — got ${JSON.stringify(entry)}`);
}

test('(RED) [Finding A, variant 1/3 — EISDIR]: a hook whose script is "scripts/." must not blank the whole /api/studio/hooks list', async () => {
  const badId = 'red4-hook-eisdir';
  const canaryA = 'red4-eisdir-canary-a';
  const canaryB = 'red4-eisdir-canary-b';
  plantValidHook(forgeRoot, canaryA, 'RED4-EISDIR-CANARY-A-MARKER-3a91f');
  plantValidHook(forgeRoot, canaryB, 'RED4-EISDIR-CANARY-B-MARKER-6c02d');
  plantScriptPathFaultHook(forgeRoot, badId, 'scripts/.');

  // Cleanup runs in `finally` — NOT after the assertions — because
  // Array.prototype.map short-circuits at the FIRST throwing entry
  // (alphabetically), so leaving this fixture behind after a FAILING
  // assertion (which throws, skipping any code after it) would make a
  // later variant's crash misattribute itself to THIS one's errno instead of
  // its own (confirmed empirically while writing these tests: an earlier
  // draft that cleaned up only after a passing run left all three variants
  // reporting the SAME EISDIR body once run.sh, not each one's own).
  try {
    const { status, text } = await get('/api/studio/hooks');
    assert.equal(
      status,
      200,
      `expected 200 (the whole list must survive one malformed hook) — got ${status}: ${text}. cli/bridge-studio-hooks.ts:191's listHookLibrary(...).map(entry => toClientListEntry(...)) has no per-entry try/catch around the hookRunState call, so this ONE hook's EISDIR at readFileSync time (path.join collapses "scripts/." to the "scripts" DIRECTORY) throws out of the whole .map(), and the route's outer catch turns that into a 500 for every hook in the library, not just this one.`,
    );
    const body = JSON.parse(text) as { hooks: HooksListEntry[] };
    assertValidHookEntrySurvives(body.hooks, canaryA, 'EISDIR variant');
    assertValidHookEntrySurvives(body.hooks, canaryB, 'EISDIR variant');
    const bad = body.hooks.find((h) => h.id === badId);
    assert.ok(bad, `expected the malformed hook "${badId}" to still appear as an entry (not vanish) — got ids: ${body.hooks.map((h) => h.id).join(', ')}`);
    assert.equal(bad!.ok, false, `expected the malformed hook to surface as ok:false rather than crash the whole route — got ${JSON.stringify(bad)}`);
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', badId), { recursive: true, force: true });
  }
});

test('[Finding A, variant 2/3]: a trailing-slash script path ("scripts/run.sh/") is now genuinely functional (not merely non-crashing) — AND the list survives regardless of which outcome it is', async () => {
  const badId = 'red4-hook-enotdir';
  const canaryA = 'red4-enotdir-canary-a';
  const canaryB = 'red4-enotdir-canary-b';
  plantValidHook(forgeRoot, canaryA, 'RED4-ENOTDIR-CANARY-A-MARKER-8b13e');
  plantValidHook(forgeRoot, canaryB, 'RED4-ENOTDIR-CANARY-B-MARKER-2f90d');
  plantScriptPathFaultHook(forgeRoot, badId, 'scripts/run.sh/');

  try {
    const { status, text } = await get('/api/studio/hooks');
    assert.equal(
      status,
      200,
      `expected 200 — an element-level fault (if this entry even still has one) must never become a collection-level failure — got ${status}: ${text}.`,
    );
    const body = JSON.parse(text) as { hooks: HooksListEntry[] };
    assertValidHookEntrySurvives(body.hooks, canaryA, 'trailing-slash variant');
    assertValidHookEntrySurvives(body.hooks, canaryB, 'trailing-slash variant');
    const entry = body.hooks.find((h) => h.id === badId);
    assert.ok(entry, `expected "${badId}" to still appear as an entry (not vanish) — got ids: ${body.hooks.map((h) => h.id).join(', ')}`);

    // AMENDED (T2 round, 2026-08-06): the read-path fix makes
    // readHookScriptBody drop the trailing "/" as a split artifact — the
    // SAME empty-segment rule the double-slash fix (Finding 3) already
    // applies — so this hook now resolves to its real script and reads
    // successfully. Asserting ok:false here would pin the OLD broken
    // degradation as the expected outcome instead of the actual invariant
    // this test protects (an element fault must never become a collection
    // failure) — the same over-specification class the round-2 amendments
    // already removed elsewhere in this file. So: accept EITHER a genuine
    // ok:false (with a real error) OR a genuine ok:true — and if it reports
    // ok:true, prove it is actually functional end-to-end, not just "didn't
    // crash the list".
    if (entry!.ok === false) {
      assert.ok(entry!.error, `expected an ok:false entry to carry a non-empty error — got ${JSON.stringify(entry)}`);
    } else {
      assert.equal(entry!.scanVerdict, 'clean', `expected the trailing-slash hook, reported ok:true, to scan clean (a benign echo script) — got ${JSON.stringify(entry)}`);
      const detail = await get(`/api/studio/hooks/${badId}`);
      assert.equal(
        detail.status,
        200,
        `expected the DETAIL route to ALSO serve this hook (proving ok:true in the list is genuine, not just "didn't crash the .map()") — got ${detail.status}: ${detail.text}`,
      );
      const detailBody = JSON.parse(detail.text) as { files?: Array<{ path: string; body: string }> };
      const scriptFile = detailBody.files?.find((f) => f.body.includes('benign'));
      assert.ok(scriptFile, `expected the detail route to return the REAL script body (containing "benign") — got ${detail.text}`);
    }
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', badId), { recursive: true, force: true }); // isolate from variant 3/3, see variant 1/3's comment
  }
});

test('(RED) [Finding A, variant 3/3 — ENOENT]: a hook whose script is "scripts\\run.sh" (one literal backslash) must not blank the whole /api/studio/hooks list', async () => {
  const badId = 'red4-hook-enoent';
  const canaryA = 'red4-enoent-canary-a';
  const canaryB = 'red4-enoent-canary-b';
  plantValidHook(forgeRoot, canaryA, 'RED4-ENOENT-CANARY-A-MARKER-5d24c');
  plantValidHook(forgeRoot, canaryB, 'RED4-ENOENT-CANARY-B-MARKER-9e60f');
  // Exactly ONE literal backslash character — confirmed via .length (14) in
  // the standalone verification script before this test was written; not
  // two backslashes, not an escape sequence artifact.
  const backslashScript = 'scripts\\run.sh';
  assert.equal(backslashScript.length, 14, 'sanity: the script field literal is exactly "scripts" + one backslash + "run.sh"');
  plantScriptPathFaultHook(forgeRoot, badId, backslashScript);

  try {
    const { status, text } = await get('/api/studio/hooks');
    assert.equal(
      status,
      200,
      `expected 200 (the whole list must survive one malformed hook) — got ${status}: ${text}. Neither path.resolve (load time) nor path.join (read time) ever splits on a literal backslash on Linux, so both treat "scripts\\\\run.sh" as a single nonexistent filename component — load time never throws (resolveHookScriptPath's realpath/symlink check only runs when the resolved path existsSync, and it doesn't), but readFileSync at read time throws ENOENT, crashing the whole .map() into a 500 for every hook.`,
    );
    const body = JSON.parse(text) as { hooks: HooksListEntry[] };
    assertValidHookEntrySurvives(body.hooks, canaryA, 'ENOENT variant');
    assertValidHookEntrySurvives(body.hooks, canaryB, 'ENOENT variant');
    const bad = body.hooks.find((h) => h.id === badId);
    assert.ok(bad, `expected the malformed hook "${badId}" to still appear as an entry (not vanish) — got ids: ${body.hooks.map((h) => h.id).join(', ')}`);
    assert.equal(bad!.ok, false, `expected the malformed hook to surface as ok:false rather than crash the whole route — got ${JSON.stringify(bad)}`);
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', badId), { recursive: true, force: true }); // isolate from any later test in this file
  }
});

// ---- FINDING B: approve/override leak a distinguishable 500 where every ---
// ---- other route in this PR returns 404 -----------------------------------
//
// cli/bridge-studio-hooks.ts:303-314 (approve) and :335-347 (override). Both
// guard `hook.yaml` via `resolveGuardedPath` and correctly collapse THAT
// rejection into 404 — but they then call `hookRunState(...)` (approve) /
// `overrideHookBlock(...)` (override), which internally call
// `loadHookDefinition`, which THROWS for a hook whose `hook.yaml` is
// genuinely real (so the `resolveGuardedPath` check on `hook.yaml` PASSES)
// but whose `scripts/run.sh` is a LEAF SYMLINK escaping the hook directory
// (`resolveHookScriptPath`'s realpath check, confirmed live before this test
// was written). That throw lands in the route's generic `catch -> 500` —
// while `GET /api/studio/hooks/:id` correctly 404s the SAME fixture, via its
// own `entry.ok !== true` check on the identical load failure. An attacker
// can therefore distinguish "no such hook" (404, everywhere else in this
// file) from "a hook exists here and its script escapes containment" (500,
// ONLY on these two routes) — a working status-code oracle. This is NOT a
// content-disclosure leak: `sanitizeError` redacts absolute paths (verified
// below), so neither the outside file's bytes nor its real path ever appear
// in the 500 body.
// ---------------------------------------------------------------------------

function plantLeakLeafSymlinkHook(root: string, id: string, outsideScriptPath: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'hook.yaml'), [
    `name: ${id}`,
    'description: hook.yaml is genuinely real; scripts/run.sh is a LEAF symlink escaping the hook dir',
    'on: SessionEnd',
    'script: scripts/run.sh',
    'permissions:',
    '  env: []',
    '  read: []',
    '  network: false',
  ].join('\n'));
  symlinkSync(outsideScriptPath, join(dir, 'scripts', 'run.sh'));
}

test('(RED) [Finding B]: POST /api/studio/hooks/:id/approve on a hook.yaml-real/script-symlink-escape fixture must read the SAME as a genuinely nonexistent hook, same as GET-detail already does', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const id = 'red4-approve-leak';
  const outside = newOutsideDir('red4-approve-leak-outside-');
  const outsideScript = join(outside, 'secret.sh');
  writeFileSync(outsideScript, '#!/bin/sh\necho SECRET-MARKER-APPROVELEAK-2f81a\n');
  plantLeakLeafSymlinkHook(forgeRoot, id, outsideScript);

  const detail = await get(`/api/studio/hooks/${id}`);
  assert.equal(detail.status, 404, `sanity: GET detail already correctly 404s this fixture (entry.ok===false from the same load failure) — got ${detail.status}: ${detail.text}`);

  const neverExistedId = 'totally-unplanted-hook-findingb-approve-xyz';
  const escaped = await post(`/api/studio/hooks/${id}/approve`, {});
  const neverExisted = await post(`/api/studio/hooks/${neverExistedId}/approve`, {});

  assert.equal(
    escaped.status,
    neverExisted.status,
    `expected approve on the script-symlink-escape fixture to read as "no such hook" (${neverExisted.status}), same as a genuinely unplanted id — got ${escaped.status}: ${escaped.text}. hookRunState (called AFTER the resolveGuardedPath hook.yaml guard already passed, since hook.yaml itself is real) throws from loadHookDefinition's realpath check on the symlinked script leaf, landing in the route's generic catch -> 500 — a status-code oracle distinguishing this fixture from a truly-nonexistent id.`,
  );
  const normalize = (text: string, rawId: string): string => text.split(rawId).join('<id>');
  assert.equal(
    normalize(escaped.text, id),
    normalize(neverExisted.text, neverExistedId),
    `expected the SAME body template (modulo the echoed id) — got escaped=${escaped.text} neverExisted=${neverExisted.text}`,
  );

  assert.ok(!escaped.text.includes('SECRET-MARKER-APPROVELEAK-2f81a'), 'sanity: the outside script content never leaks either way');
  assert.ok(!escaped.text.includes(outside), `sanitizeError must redact the outside dir's absolute path — got: ${escaped.text}`);
  assert.ok(!escaped.text.includes(forgeRoot), `sanitizeError must redact forgeRoot's absolute path too — got: ${escaped.text}`);

  const ledgerAfter = readHookApprovalLedger(forgeRoot).has(id);
  assert.equal(ledgerAfter, false, `no approval-ledger entry may be recorded for "${id}" — got status ${escaped.status}: ${escaped.text}`);
});

test('(RED) [Finding B]: POST /api/studio/hooks/:id/override on the SAME shape of fixture must read the SAME as a genuinely nonexistent hook, same as GET-detail already does', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const id = 'red4-override-leak';
  const outside = newOutsideDir('red4-override-leak-outside-');
  const outsideScript = join(outside, 'secret.sh');
  writeFileSync(outsideScript, '#!/bin/sh\necho SECRET-MARKER-OVERRIDELEAK-7b03e\n');
  plantLeakLeafSymlinkHook(forgeRoot, id, outsideScript);

  const detail = await get(`/api/studio/hooks/${id}`);
  assert.equal(detail.status, 404, `sanity: GET detail already correctly 404s this fixture — got ${detail.status}: ${detail.text}`);

  const neverExistedId = 'totally-unplanted-hook-findingb-override-xyz';
  const escaped = await post(`/api/studio/hooks/${id}/override`, { reason: 'operator accepts the risk' });
  const neverExisted = await post(`/api/studio/hooks/${neverExistedId}/override`, { reason: 'operator accepts the risk' });

  assert.equal(
    escaped.status,
    neverExisted.status,
    `expected override on the script-symlink-escape fixture to read as "no such hook" (${neverExisted.status}), same as a genuinely unplanted id — got ${escaped.status}: ${escaped.text}. overrideHookBlock (called AFTER the resolveGuardedPath hook.yaml guard already passed) calls loadHookDefinition directly, which throws from the same realpath check on the symlinked script leaf, landing in the route's generic catch -> 500.`,
  );
  const normalize = (text: string, rawId: string): string => text.split(rawId).join('<id>');
  assert.equal(
    normalize(escaped.text, id),
    normalize(neverExisted.text, neverExistedId),
    `expected the SAME body template (modulo the echoed id) — got escaped=${escaped.text} neverExisted=${neverExisted.text}`,
  );

  assert.ok(!escaped.text.includes('SECRET-MARKER-OVERRIDELEAK-7b03e'), 'sanity: the outside script content never leaks either way');
  assert.ok(!escaped.text.includes(outside), `sanitizeError must redact the outside dir's absolute path — got: ${escaped.text}`);
  assert.ok(!escaped.text.includes(forgeRoot), `sanitizeError must redact forgeRoot's absolute path too — got: ${escaped.text}`);

  const ledgerAfter = readHookApprovalLedger(forgeRoot).has(id);
  assert.equal(ledgerAfter, false, `no approval-ledger entry may be recorded for "${id}" — got status ${escaped.status}: ${escaped.text}`);
});

test('non-regression [Finding B]: a normal, valid hook still approves successfully (200) and IS recorded in the ledger', async () => {
  const id = 'red4-approve-plain';
  plantValidHook(forgeRoot, id, 'RED4-APPROVE-PLAIN-MARKER-9d41c');

  const before_ = readHookApprovalLedger(forgeRoot).has(id);
  assert.equal(before_, false, 'sanity: no pre-existing ledger entry');

  const { status, text } = await post(`/api/studio/hooks/${id}/approve`, {});
  assert.equal(status, 200, `expected a normal, valid hook to approve fine — got ${status}: ${text}`);

  const ledgerEntry = readHookApprovalLedger(forgeRoot).get(id);
  assert.ok(ledgerEntry, `expected "${id}" to be recorded in the approval ledger — got none`);
  assert.equal(ledgerEntry!.overridden, false, `expected a plain approval to record overridden:false — got ${JSON.stringify(ledgerEntry)}`);
});

test('non-regression [Finding B]: a normal, valid hook still overrides successfully (200) and IS recorded in the ledger with overridden:true', async () => {
  const id = 'red4-override-plain';
  plantValidHook(forgeRoot, id, 'RED4-OVERRIDE-PLAIN-MARKER-1e77a');

  const before_ = readHookApprovalLedger(forgeRoot).has(id);
  assert.equal(before_, false, 'sanity: no pre-existing ledger entry');

  const { status, text } = await post(`/api/studio/hooks/${id}/override`, { reason: 'operator accepts the risk' });
  assert.equal(status, 200, `expected a normal, valid hook to override fine — got ${status}: ${text}`);

  const ledgerEntry = readHookApprovalLedger(forgeRoot).get(id);
  assert.ok(ledgerEntry, `expected "${id}" to be recorded in the approval ledger — got none`);
  assert.equal(ledgerEntry!.overridden, true, `expected an override to record overridden:true — got ${JSON.stringify(ledgerEntry)}`);
  assert.equal(ledgerEntry!.reason, 'operator accepts the risk', `expected the reason to be recorded — got ${JSON.stringify(ledgerEntry)}`);
});
