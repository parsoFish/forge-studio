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

test('RED: GET /api/studio/flows/escape-flow leaks the outside flow.yaml through a dir-symlinked studio/flows/<id>', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const { status, text } = await get('/api/studio/flows/escape-flow');
  assert.equal(status, 200, `expected the (buggy) lexical guard to let this through with 200, got ${status}: ${text}`);
  assert.ok(
    !text.includes('SECRET-MARKER-FLOWGET-a11c3'),
    `the flow-detail response must NOT reflect the outside flow.yaml's content — got: ${text}. cli/bridge-studio.ts's GET route does \`resolve(flowsBase,id,'flow.yaml').startsWith(flowsBase+sep)\` on the UNRESOLVED path — this is always true for any slug-shaped id, symlink or not.`,
  );
});

// ---------------------------------------------------------------------------
// GET /api/studio/skills/:id
// ---------------------------------------------------------------------------

test('accidental-pass (regression lock, NOT a containment pin): GET /api/studio/skills/escape-skill does not leak — an UNRELATED internal-consistency throw fires first', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // ACCIDENT NAMED: the route reads mdPath (skillPath(), a bare join through
  // the symlink) FINE — isStudioAgent/skillTrustDetail/readSkillPackage all
  // successfully read the outside content. But before assembling any
  // response it does `listSkillLibrary(ctx.forgeRoot).find(e => e.id ===
  // id)` and throws an "internal inconsistency" Error if that lookup misses.
  // listSkillLibrary's discovery walk (listSkillDirs, orchestrator/skill-
  // path.ts) does `readdirSync(dir,{withFileTypes:true}).filter(e =>
  // e.isDirectory())` — Dirent.isDirectory() reports false for a symlinked
  // directory ENTRY (confirmed empirically, same family as the
  // discoverProjects()/loadKbDescriptors() accidents already documented) —
  // so "escape-skill" is invisible to listSkillLibrary even though skillPath
  // resolved and read it moments earlier. The route 500s on that mismatch
  // BEFORE ever building the `detail` object, so the content it already read
  // never reaches the response body. This is an accident of an unrelated
  // invariant check, not a fix for skillPath()'s missing identity check —
  // the underlying read-through-the-symlink already happened.
  const { status, text } = await get('/api/studio/skills/escape-skill');
  assert.equal(status, 500, `expected the accidental 500 (internal inconsistency), got ${status}: ${text}`);
  assert.ok(!text.includes('SECRET-MARKER-SKILLGET-7cd21'), 'no leak either way — the error message is generic, not the file content');
});

// ---------------------------------------------------------------------------
// POST /api/studio/skills/:id/approve
// ---------------------------------------------------------------------------

test('RED (headline repro): POST /api/studio/skills/escape-skill-draft/approve WRITES through the dir-symlinked skills/<id>, mutating the outside file', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // Unlike GET-detail, approve does NOT consult listSkillLibrary at all —
  // skillTrustDetail reads mdPath (skillPath(), a bare join through the
  // symlink) directly, sees `status: draft`, and approveSkillDraft then
  // WRITES to that same mdPath (flip library:true, drop status:draft) — a
  // genuine arbitrary-file-write via the approve route.
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

test('RED: POST /api/studio/hooks with id "escape-hook-create" writes THROUGH the dir-symlinked studio/hooks/<id> into the outside dir', async (t) => {
  if (skipIfNoSymlinks(t)) return;
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
  assert.notDeepEqual(
    after_,
    [],
    'sanity: if the route rejected the traversal (fixed behavior), the outside dir stays empty forever — this branch only runs to characterize what changed',
  );
  assert.deepEqual(
    after_,
    before_,
    `nothing may be created inside the outside directory a symlinked studio/hooks/<id> points at — status ${status}: ${text}. before=${JSON.stringify(before_)} after=${JSON.stringify(after_)}. Today: hookDir()/hook-library.ts's assertSkillSlug validates the STRING SHAPE of "escape-hook-create" only; the subsequent \`mkdirSync(join(hookDirPath,'scripts'))\` + \`writeFileSync\` follow the symlinked directory straight through to the outside location.`,
  );
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
// POST /api/studio/hooks/:id/approve — genuinely blocked today, but by a
// DIFFERENT, pre-existing check than the one this defect names.
// ---------------------------------------------------------------------------

test('already-guarded (NOT this defect — a different pre-existing check, wrong status code): POST /api/studio/hooks/escape-hook-read/approve never records an approval, but 500s instead of 400ing', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  // approve does NOT consult listHookLibrary (unlike GET-detail above) — it
  // calls hookYamlPath()/existsSync directly (bare join through the
  // symlink, succeeds), then hookRunState -> loadHookDefinition ->
  // resolveHookScriptPath (orchestrator/studio/hook-library.ts ~L163-193),
  // which realpath-checks the hook's SCRIPT path against the hook dir's
  // LEXICAL (unresolved) path — a check built for a different purpose
  // (script-path traversal within a hook package) that, as a side effect,
  // also throws for ANY symlinked hook directory (the script's real
  // location can never match the lexical, unresolved hookDirPath prefix
  // once the directory itself is a symlink). This IS real protection — no
  // ledger entry is ever recorded — but it throws an uncaught-shape 500
  // (sanitizeError'd, no path leaked) rather than the conventional 400 every
  // other guarded route in this codebase returns for a rejected path. Kept
  // as a regression lock on "never records an approval for a symlinked hook
  // dir", explicitly NOT claimed as the fix for the hookDir/hookYamlPath
  // containment gap the brief names (a hook package whose id resolves to a
  // real, readable hook.yaml but whose `script` field is absent/blank would
  // not hit this check at all).
  const ledgerBefore = readHookApprovalLedger(forgeRoot).has('escape-hook-read');
  assert.equal(ledgerBefore, false, 'sanity: no pre-existing ledger entry');

  const { status, text } = await post('/api/studio/hooks/escape-hook-read/approve', {});
  assert.notEqual(status, 200, `approve must never SUCCEED through a symlinked hook dir — got 200: ${text}`);

  const ledgerAfter = readHookApprovalLedger(forgeRoot).has('escape-hook-read');
  assert.equal(ledgerAfter, false, `no approval-ledger entry may be recorded for "escape-hook-read" — got status ${status}: ${text}`);
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
