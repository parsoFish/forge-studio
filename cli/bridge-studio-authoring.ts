/**
 * Forge Studio authoring-session finalize route (R4-21 phase 2, WI-2 — the
 * OOTB authoring agent / skill-hook-template package producer, save path;
 * `kind:'template'` added W8-B4/WI-3).
 *
 * Owns the ONE `/api/studio/authoring*` route:
 *
 *   POST /api/studio/authoring/finalize   → the operator's COMMIT act: drive
 *                                            the creation-agent session's
 *                                            `committing` turn and install
 *                                            the LANDED package into the real
 *                                            skill, hook, or template library
 *
 * ---------------------------------------------------------------------------
 * CONTRACT (D5, `_wave5/unit-specs/R4-21-phase2.md`; mirrored from
 * `cli/bridge-studio-authoring-finalize.test.ts`'s own header — that file is
 * this module's spec):
 *
 *  Wire contract: `POST /api/studio/authoring/finalize { project, sessionId,
 *  kind: 'skill'|'hook'|'template', id }` — NOTHING ELSE is read from the
 *  body. The installed artifact's bytes come from the server-landed package,
 *  never the request body (closes the client-supplied-content sink the
 *  phase-1 shape had).
 *
 *  Sequence:
 *   1. Resolve the projects root the SAME way every other bridge route does
 *      (`resolveProjectsDir` + `loadConfig`/`defaultConfigPath`) — never a
 *      hardcoded `<cwd>/projects`.
 *   2. Resolve the session dir with `project` and `sessionId` EACH riding as
 *      their own guarded segment — `resolveGuardedPath(projectsRoot,
 *      [project, '_authoring', sessionId])`. Never folded into the root (that
 *      would make containment tautological — see
 *      `cli/studio-path-guard.ts`'s own CONTRACT section).
 *   3. Read `status.json` through the guarded read (leaf included, via
 *      `orchestrator/interactive-session.ts`'s `guardedReadSessionStatus` —
 *      the SAME primitive `runInteractiveTurn` itself uses). Require
 *      `phase === 'awaiting-review'` → 409 naming the current AND required
 *      phase otherwise. Never a silent 200.
 *   4. Guarded-write the status with `package_id: id` and `phase:
 *      'committing'` (`guardedWriteSessionStatus`).
 *   5. Run ONE turn on the SAME spine the CLI dispatches to —
 *      `runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot })`
 *      — imported DYNAMICALLY (see below). The `committing` step performs no
 *      SDK spawn (it runs `copyStagingToLibrary`), so this call is fast and
 *      deterministic. Assert the returned phase is `committed`; anything else
 *      fails loud (5xx), never a silent success on an unfinished turn.
 *   6. Read the LANDED package at `<forgeRoot>/_interactive-library/<id>/`
 *      through the guard and install:
 *        - `kind:'skill'` → `installSkillPackage` with a SERVER-MINTED
 *          `upstream: { source: 'forge-authoring', ref: sessionId }` — never
 *          read from the request body (a client cannot supply its own
 *          provenance). Lands a DRAFT; `approveSkillDraft` is NEVER called
 *          here — palette visibility stays the operator's separate, later
 *          act at `POST /api/studio/skills/:id/approve` (D6).
 *        - `kind:'hook'` → hook metadata is read from the LANDED
 *          `hook.yaml` (parsed server-side), never from body fields: refuse
 *          (400, nothing written) on a `FORBIDDEN_HOOK_BINDING_KEYS` key, an
 *          `on` outside `HOOK_LIFECYCLE_EVENTS`, or a hook.yaml that is
 *          missing/unparseable/not a mapping — fail loud, never fabricate a
 *          default. Otherwise write the existing 2-file shape (`hook.yaml` +
 *          the fixed relative `scripts/run.sh`) through the SAME guarded
 *          choke points `POST /api/studio/hooks` already uses.
 *        - `kind:'template'` (W8-B4/WI-3) → the SAME posture as `kind:'hook'`:
 *          the landed `template.md`'s frontmatter is read server-side, never
 *          from body fields. Its `category` field is a DRAFT-ONLY routing
 *          hint — real installed templates never carry one (category is
 *          STRUCTURAL, derived from which directory a definition lives in,
 *          `orchestrator/studio/template-library.ts`'s own D1) — validated by
 *          `writableCategoryOrReason` (`cli/bridge-studio-templates.ts`, the
 *          SAME function `POST /api/studio/templates` uses) and stripped
 *          before the persisted bytes are written. `project-scaffold` is
 *          refused with the SAME `SCAFFOLD_READONLY` constant that route
 *          returns — never a second, drifting copy of that rule. The
 *          remaining content is then validated by the SAME real-category-
 *          loader check (`invalidTemplateContentReason`) that route also
 *          uses, and written through the SAME `WRITABLE_CATEGORY_DIRS` +
 *          guarded-path choke point.
 *   7. `{ ok: true, kind, id }`.
 *
 *  Design call: a hook-specific validation failure at step 6 does NOT roll
 *  back step 5's already-successful generic copy — nothing in D5 describes a
 *  rollback, and `interactive-finalizers.ts`'s own header disclaims any
 *  hook-shape awareness at that layer (it is a generic COPY primitive). The
 *  negative hook paths below therefore assert the ARTIFACT step 6 alone owns
 *  (`hooks/<id>/` absent), not whether the session's `status.json` phase gets
 *  reverted — an unspecified, implementation-owned detail.
 *
 *  Every refusal leaves the filesystem untouched at the layer it owns — the
 *  pinned tests assert the ARTIFACT (file/dir absence), not just the status
 *  code.
 *
 *  RECOVERABILITY (T3 fix round, `_wave5/unit-specs/R4-21-phase2.md` P5/P6):
 *  step 4 advances `status.json` to `phase:'committing'` BEFORE step 5 runs,
 *  and nothing downstream can leave that write stranded — ANY failure from
 *  step 5 onward (the turn throwing, the turn not reaching `committed`, the
 *  landed package missing, or the install step at step 6 refusing —
 *  including an `installSkillPackage` `alreadyInstalled` collision, which
 *  this route now surfaces as a 409 instead of discarding the operator's
 *  draft and reporting success) reverts `status.json` back to
 *  `phase:'awaiting-review'` through the SAME guarded choke point
 *  (`guardedWriteSessionStatus`) BEFORE the error response is sent — never a
 *  new write path, never a raw `fs` call. A successful finalize (step 7)
 *  never reverts: it ends at `committed`, and a later re-finalize attempt
 *  correctly 409s again (never a silent bounce back to `awaiting-review`).
 *  See `revertToAwaitingReview` below for the single call site this fans out
 *  from.
 *
 *  LANDED-PACKAGE CLEANUP (library-37 fix, W8-B4/WI-3): `<forgeRoot>/
 *  _interactive-library/<id>/` (step 5's copy target) is an internal
 *  staging→landing BRIDGE, never a durable record — it is `_interactive-
 *  library`-gitignored, has no Studio surface, and the real record of a
 *  successful finalize is the installed skill/hook/template itself. Every
 *  attempt (success OR failure) removes it in a `finally` after steps 5-6
 *  run, so a package `id` is never permanently unusable via a leftover ghost
 *  directory nobody can see or clear. This does NOT weaken the id-collision
 *  check: a `kind`-specific real-library collision (an existing
 *  `skills/<id>/`, `studio/hooks/<id>/`, or template-library entry) still
 *  409s, naming that REAL holder — see `finalizeSkillFromLanded` /
 *  `finalizeHookFromLanded` / `finalizeTemplateFromLanded` below. Only the
 *  GHOST-dir 409 (a collision against nothing but a leftover copy from a
 *  prior, unrelated attempt under the same id) is gone.
 * ---------------------------------------------------------------------------
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';

import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
import { resolveGuardedPath, guardedReadFile } from './studio-path-guard.ts';
import { installSkillPackage, SkillIdOccupiedError } from '../orchestrator/studio/skill-library.ts';
import {
  hookDir,
  hooksDir,
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  type HookPermissionManifest,
} from '../orchestrator/studio/hook-library.ts';
import { reqString, optString, oneOf } from '../orchestrator/studio/yaml-fields.ts';
import { resolveProjectsDir, loadConfig, defaultConfigPath } from '../orchestrator/config.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from '../orchestrator/interactive-session.ts';
import { loadSessionKinds } from '../orchestrator/studio/session-kinds.ts';
import { isReservedId } from '../orchestrator/skill-path.ts';
import { listTemplateLibrary } from '../orchestrator/studio/template-library.ts';
import {
  writableCategoryOrReason,
  WRITABLE_CATEGORY_DIRS,
  invalidTemplateIdReason,
  invalidTemplateContentReason,
} from './bridge-studio-templates.ts';
// Type-only — erased by --experimental-strip-types, so this does NOT pull the
// Claude Agent SDK into bridge start-up. The runtime function is imported
// DYNAMICALLY, inside runFinalize, below (mirrors cli/agent-run.ts's own
// project-brain-builder-runner dynamic-import precedent).
import type { InteractiveTurnStatus, RunInteractiveTurnResult } from '../orchestrator/interactive-runner.ts';

const FINALIZE_URL = '/api/studio/authoring/finalize';

/** Server-minted provenance for every package this route installs — the
 *  provenance of an authored package IS the session that authored it. Never
 *  read from the request body (a client-supplied upstream is unverifiable). */
const AUTHORING_UPSTREAM_SOURCE = 'forge-authoring';

/** The dedicated, non-scanned landing root `runInteractiveTurn`'s
 *  `copyStagingToLibrary` finalizer writes into (`orchestrator/
 *  interactive-runner.ts`'s own `INTERACTIVE_LIBRARY_DIRNAME` constant,
 *  mirrored here since that one is module-private). */
const INTERACTIVE_LIBRARY_DIRNAME = '_interactive-library';

const REQUIRED_PHASE = 'awaiting-review';

function parseFinalizeHookPermissions(raw: unknown): HookPermissionManifest | { error: string } {
  if (raw === undefined) return { env: [], read: [], network: false };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'hook.yaml permissions must be an object' };
  }
  const p = raw as Record<string, unknown>;
  const env = p['env'];
  const read = p['read'];
  const network = p['network'];
  if (env !== undefined && (!Array.isArray(env) || !env.every((x) => typeof x === 'string'))) {
    return { error: 'hook.yaml permissions.env must be an array of strings' };
  }
  if (read !== undefined && (!Array.isArray(read) || !read.every((x) => typeof x === 'string'))) {
    return { error: 'hook.yaml permissions.read must be an array of strings' };
  }
  if (network !== undefined && typeof network !== 'boolean') {
    return { error: 'hook.yaml permissions.network must be a boolean' };
  }
  return {
    env: Array.isArray(env) ? (env as string[]) : [],
    read: Array.isArray(read) ? (read as string[]) : [],
    network: network === true,
  };
}

// ---------------------------------------------------------------------------
// Finding 1/2 fix — the two install-step functions below return an OUTCOME
// instead of writing the HTTP response themselves. `runFinalize` is the ONE
// place that decides what a failed outcome means (revert phase:'committing'
// back to "awaiting-review", THEN respond) so every failure path — a bad
// package, a hook validation refusal, or an id collision — reverts
// identically, never a bespoke per-branch call.
// ---------------------------------------------------------------------------

type InstallOutcome = { ok: true } | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// kind:"skill" — installs the LANDED package (_interactive-library/<id>/) via
// the SAME installSkillPackage every other skill-install path uses.
// ---------------------------------------------------------------------------

async function finalizeSkillFromLanded(
  forgeRoot: string,
  packageDir: string,
  id: string,
  sessionId: string,
): Promise<InstallOutcome> {
  try {
    // D-5/D6: always lands a DRAFT (status:'draft', library:false) —
    // approveSkillDraft is never called from this route. Upstream is
    // SERVER-MINTED, never read from the request body.
    const result = installSkillPackage({
      forgeRoot,
      id,
      packageDir,
      upstream: { source: AUTHORING_UPSTREAM_SOURCE, ref: sessionId },
    });
    // Finding 2 fix: installSkillPackage is idempotent BY DESIGN — an
    // existing skills/<id>/SKILL.md means it wrote NOTHING and the
    // operator's authored draft was just silently discarded. The two
    // sibling callers of this same function (cli/bridge-studio-skills.ts,
    // cli/bridge-studio-community.ts) both surface `alreadyInstalled`; this
    // route must too, rather than reporting the discard as a 200 success.
    if (result.alreadyInstalled) {
      return { ok: false, status: 409, error: `skill "${id}" already exists — choose a different id` };
    }
    return { ok: true };
  } catch (err) {
    // W7-B3 (library-31): an id occupied by an UNMANAGED local skill now
    // throws the NAMED SkillIdOccupiedError instead of answering a false
    // `alreadyInstalled` — for this route it is the SAME operator fact as
    // the managed collision above: the id is taken, pick another. 409.
    if (err instanceof SkillIdOccupiedError) {
      return { ok: false, status: 409, error: `skill "${id}" already exists — choose a different id` };
    }
    // Every OTHER installSkillPackage throw (bad slug, no SKILL.md at the
    // package root, cap exceeded, binary file, escaping destination, ...)
    // is a caller-input problem by contract — 400, never a 500 here.
    return { ok: false, status: 400, error: sanitizeError(err) };
  }
}

// ---------------------------------------------------------------------------
// kind:"hook" — hook METADATA comes from the LANDED, DRAFTED hook.yaml,
// parsed server-side, never from parallel request-body fields.
// ---------------------------------------------------------------------------

function finalizeHookFromLanded(forgeRoot: string, id: string): InstallOutcome {
  const yamlRaw = guardedReadFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, 'hook.yaml']);
  if (yamlRaw === null) {
    return { ok: false, status: 400, error: `drafted hook.yaml is missing from the landed package "${id}"` };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlRaw);
  } catch (err) {
    return { ok: false, status: 400, error: `drafted hook.yaml is not valid YAML: ${sanitizeError(err)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'drafted hook.yaml must be a YAML mapping (object), not a scalar/array/null' };
  }
  const doc = parsed as Record<string, unknown>;

  // The SAME forbidden-binding-key rejection POST /api/studio/hooks
  // enforces, checked BEFORE any filesystem write — now against the LANDED
  // hook.yaml's own fields.
  for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
    if (key in doc) {
      return {
        ok: false,
        status: 400,
        error: `drafted hook.yaml must not declare a binding field "${key}" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder`,
      };
    }
  }

  let name: string;
  let description: string;
  let on: HookLifecycleEvent;
  try {
    name = reqString(doc, 'name', 'hook.yaml');
    description = reqString(doc, 'description', 'hook.yaml');
    on = oneOf(reqString(doc, 'on', 'hook.yaml'), HOOK_LIFECYCLE_EVENTS, 'hook.yaml', 'on');
  } catch (err) {
    return { ok: false, status: 400, error: sanitizeError(err) };
  }
  const matcher = optString(doc, 'matcher');

  const permissions = parseFinalizeHookPermissions(doc['permissions']);
  if ('error' in permissions) {
    return { ok: false, status: 400, error: permissions.error };
  }

  const scriptRaw = guardedReadFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, 'scripts', 'run.sh']);
  if (scriptRaw === null) {
    return { ok: false, status: 400, error: `drafted scripts/run.sh is missing from the landed package "${id}"` };
  }

  // Layer 1 — SHAPE: `hookDir` runs `assertSkillSlug` (charset only).
  try {
    hookDir(id, forgeRoot);
  } catch (err) {
    return { ok: false, status: 400, error: sanitizeError(err) };
  }

  // Layer 2 — CONTAINMENT: the SAME guarded choke point
  // POST /api/studio/hooks uses — never a fresh lexical startsWith.
  const yamlGuard = resolveGuardedPath(hooksDir(forgeRoot), [id, 'hook.yaml']);
  if (!yamlGuard.ok) {
    return { ok: false, status: 400, error: 'path traversal detected' };
  }
  if (yamlGuard.exists) {
    return { ok: false, status: 409, error: `hook "${id}" already exists` };
  }
  const scriptGuard = resolveGuardedPath(hooksDir(forgeRoot), [id, 'scripts', 'run.sh']);
  if (!scriptGuard.ok) {
    return { ok: false, status: 400, error: 'path traversal detected' };
  }

  const outDoc: Record<string, unknown> = {
    name,
    description,
    on,
    ...(matcher ? { matcher } : {}),
    // The SAME fixed relative script path POST /api/studio/hooks always
    // writes — never the drafted hook.yaml's own (unvalidated) script field.
    script: 'scripts/run.sh',
    permissions,
  };

  mkdirSync(dirname(scriptGuard.realPath), { recursive: true });
  writeFileSync(scriptGuard.realPath, scriptRaw, 'utf8');
  writeFileSync(yamlGuard.realPath, yaml.dump(outDoc), 'utf8');

  return { ok: true };
}

// ---------------------------------------------------------------------------
// kind:"template" (W8-B4/WI-3) — the SAME posture as kind:"hook": template
// METADATA comes from the LANDED, DRAFTED template.md, parsed server-side,
// never from parallel request-body fields.
//
// A template is ONE markdown file with gray-matter frontmatter
// (forge-ui/app/templates/new/page.tsx's own seedContent — the manual
// builder's precedent; orchestrator/studio/template-library.ts D1) — never a
// multi-file package, unlike skill/hook. The creation-agent session drafts it
// at the ONE canonical staging filename `staging/template.md`
// (TEMPLATE_STAGING_FILENAME below), mirroring `SKILL.md`/`hook.yaml`'s own
// one-canonical-name-per-shape convention, and lands unchanged at
// `_interactive-library/<id>/template.md`.
//
// `category` ('planning' | 'demo-output') is NOT a field of a REAL, installed
// template.md — template-library.ts's D1 states category is STRUCTURAL,
// derived from which directory a definition lives in, never sniffed from
// content. But the interactive session has no separate structured "category"
// channel the way the manual /templates/new builder's own UI select does
// (forge-ui/app/templates/new/page.tsx) — so the drafted file carries
// `category` as a DRAFT-ONLY routing hint in its frontmatter, read HERE to
// pick the target directory, validated by the SAME `writableCategoryOrReason`
// the POST /api/studio/templates route uses (never a second, drifting copy
// of "which categories are writable" / "why project-scaffold isn't" — reuses
// that exact function AND its `SCAFFOLD_READONLY` constant), then STRIPPED
// before the persisted bytes are written — so an installed, authored
// template's frontmatter is byte-identical in shape to one authored by hand
// through /templates/new.
// ---------------------------------------------------------------------------

const TEMPLATE_STAGING_FILENAME = 'template.md';

function finalizeTemplateFromLanded(forgeRoot: string, id: string): InstallOutcome {
  // Layer 1 — SHAPE, the SAME checks POST /api/studio/templates runs before
  // any write: slug shape/length, then the reserved-id collision with the
  // /templates/new builder's own fixed path.
  const invalidId = invalidTemplateIdReason(id);
  if (invalidId) return { ok: false, status: 400, error: invalidId };
  if (isReservedId(id)) {
    return {
      ok: false,
      status: 400,
      error: `template id "${id}" is reserved (the /templates/new builder lives at that path) — choose another id`,
    };
  }

  const raw = guardedReadFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, TEMPLATE_STAGING_FILENAME]);
  if (raw === null) {
    return { ok: false, status: 400, error: `drafted ${TEMPLATE_STAGING_FILENAME} is missing from the landed package "${id}"` };
  }

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw, {});
  } catch (err) {
    return { ok: false, status: 400, error: `drafted ${TEMPLATE_STAGING_FILENAME} is not valid frontmatter: ${sanitizeError(err)}` };
  }
  const data: unknown = parsed.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      status: 400,
      error: `drafted ${TEMPLATE_STAGING_FILENAME} frontmatter must be a YAML mapping (object), not a scalar/array/null`,
    };
  }
  const { category: draftedCategory, ...persistedData } = data as Record<string, unknown>;

  // Layer 2 — the SAME category rule POST /api/studio/templates enforces
  // (never a second copy): refuses an unknown category generically and
  // 'project-scaffold' specifically via SCAFFOLD_READONLY.
  const categoryCheck = writableCategoryOrReason(draftedCategory);
  if ('error' in categoryCheck) {
    return { ok: false, status: 400, error: categoryCheck.error };
  }
  const category = categoryCheck.category;

  // Library-wide uniqueness — the SAME check POST /api/studio/templates
  // runs, against the REAL library (never the ghost _interactive-library
  // copy — see the file header's LANDED-PACKAGE CLEANUP note / library-37).
  if (listTemplateLibrary(forgeRoot).some((e) => e.id === id)) {
    return { ok: false, status: 409, error: `template "${id}" already exists` };
  }

  // Reconstruct WITHOUT the draft-only "category" routing field — a real,
  // installed template.md never carries one (category is structural, D1).
  const content = matter.stringify(parsed.content, persistedData);

  // Layer 3 — CONTENT: the SAME real-category-loader check
  // (invalidTemplateContentReason) POST /api/studio/templates uses — never a
  // re-implemented field list.
  const invalidContent = invalidTemplateContentReason(forgeRoot, category, id, content);
  if (invalidContent) return { ok: false, status: 400, error: invalidContent };

  // Layer 4 — CONTAINMENT: the SAME guarded choke point
  // POST /api/studio/templates uses — never a fresh lexical join.
  const dirSegments = WRITABLE_CATEGORY_DIRS[category];
  const targetGuard = resolveGuardedPath(resolve(forgeRoot, ...dirSegments), [`${id}.md`]);
  if (!targetGuard.ok) return { ok: false, status: 400, error: 'path traversal detected' };
  if (targetGuard.exists) return { ok: false, status: 409, error: `template "${id}" already exists` };

  writeFileSync(targetGuard.realPath, content, 'utf8');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Finding 1 fix — revert status.json's phase back to "awaiting-review"
// through the SAME guarded choke point (guardedWriteSessionStatus) step 4 of
// runFinalize used to advance it, on ANY failure after that advance. Built
// from `preCommitStatus` — the status object read in step 3, BEFORE
// `package_id`/`phase:'committing'` were attached — so a reverted session
// carries no trace of the failed attempt's id; a later retry starts clean.
// NEVER called on the success path (P5-3's control: a committed session
// stays committed).
//
// Attack-the-fix check #3 (T3 brief): best-effort. If the revert write
// ITSELF fails (a second guard rejection, or a raw fs error), this swallows
// that secondary failure rather than throwing a DIFFERENT error over the one
// already being reported to the operator. The session then stays at
// "committing" — the SAME pre-existing bricked state this fix targets, in
// the (doubly unlikely) case the revert cannot be helped — never a
// fabricated THIRD phase value: guardedWriteSessionStatus only ever writes
// `{...preCommitStatus, phase: REQUIRED_PHASE}` or nothing at all.
// ---------------------------------------------------------------------------

function revertToAwaitingReview(
  projectsRoot: string,
  dirSegments: readonly string[],
  preCommitStatus: InteractiveTurnStatus,
): void {
  try {
    guardedWriteSessionStatus(projectsRoot, dirSegments, { ...preCommitStatus, phase: REQUIRED_PHASE });
  } catch {
    /* best-effort — see doc comment above */
  }
}

// ---------------------------------------------------------------------------
// D5 — the finalize sequence.
// ---------------------------------------------------------------------------

/** Exported (W6-B4) so cli/bridge-studio-affordances.ts's generic
 *  session-affordance write endpoint can delegate authoring's `verdict:
 *  'approve'` affordance WHOLESALE to this exact sequence — the
 *  copyStagingToLibrary + skill/hook-install flow is too security-sensitive
 *  to duplicate; the generic route validates its own body shape ({verdict,
 *  kind, id}) and hands off, letting this function send its own response
 *  (success and every failure path) exactly as it already does for
 *  POST /api/studio/authoring/finalize. */
export async function runFinalize(
  ctx: StudioContext,
  res: ServerResponse,
  origin: string,
  input: { project: string; sessionId: string; kind: 'skill' | 'hook' | 'template'; id: string },
): Promise<void> {
  const { project, sessionId, kind, id } = input;

  try {
    // Step 1 — the projects root, resolved the way every other bridge route
    // does. Never a hardcoded `<cwd>/projects`.
    const projectsRoot = resolveProjectsDir(ctx.forgeRoot, loadConfig(defaultConfigPath(ctx.forgeRoot)));

    // Step 2 — `project` and `sessionId` EACH ride as their OWN guarded
    // segment. Never folded into the root.
    const dirSegments = [project, '_authoring', sessionId];
    const sessionGuard = resolveGuardedPath(projectsRoot, dirSegments);
    if (!sessionGuard.ok) {
      sendJson(res, 400, { error: 'invalid project or session' }, origin);
      return;
    }
    if (!sessionGuard.exists) {
      sendJson(res, 404, { error: 'session not found' }, origin);
      return;
    }

    // Step 3 — the guarded read (leaf included) — the SAME primitive
    // runInteractiveTurn itself uses for its own status reads.
    const status = guardedReadSessionStatus<InteractiveTurnStatus>(projectsRoot, dirSegments);
    if (!status) {
      sendJson(res, 404, { error: 'session status not found' }, origin);
      return;
    }
    if (status.phase !== REQUIRED_PHASE) {
      sendJson(res, 409, {
        error: `cannot finalize: session is in phase "${status.phase}", required phase is "${REQUIRED_PHASE}"`,
      }, origin);
      return;
    }

    // Step 4 — guarded-write package_id + phase:'committing'.
    const written = guardedWriteSessionStatus(projectsRoot, dirSegments, { ...status, package_id: id, phase: 'committing' });
    if (written === null) {
      sendJson(res, 500, { error: 'failed to advance session status to "committing"' }, origin);
      return;
    }

    // -------------------------------------------------------------------
    // Finding 1 fix: from this point on, phase HAS been advanced to
    // "committing" on disk. Everything below runs inside its OWN
    // try/catch so ANY failure past this point — an explicit refusal (a
    // packageId that fails SLUG_RE downstream, a session with no
    // staging/, an id collision in either library, a malformed drafted
    // hook.yaml) OR an unexpected throw — reverts status.json back to
    // "awaiting-review" via `revert()` BEFORE the error response is sent.
    // `revert` is the ONE call site every failure branch below shares, so
    // there is exactly one place that decides how to recover — never a
    // bespoke per-branch write.
    // -------------------------------------------------------------------
    const revert = (): void => revertToAwaitingReview(projectsRoot, dirSegments, status);

    // sessionGuard.realPath === <projectsRoot realpath>/<project>/_authoring/
    // <sessionId> (resolveGuardedPath's own per-segment join order) — the
    // project root is the same value with the trailing two segments
    // stripped. No second guard call needed: the identity of `project` was
    // already fully verified by the walk above.
    const projectRoot = dirname(dirname(sessionGuard.realPath));

    try {
      // library-37 fix (W8-B4/WI-3): the former "Step 4.5" preflight here
      // used the LANDED `_interactive-library/<id>/` directory's mere
      // existence as a collision signal — but that directory is never
      // cleaned up on ANY outcome (until the `finally` below), so it was
      // really an id LEDGER built out of a hidden, gitignored, no-Studio-
      // surface staging leftover: once any attempt — even one that later
      // failed and correctly reverted its own session — reached step 5 under
      // a given id, that id was permanently unusable, and the 409 it
      // produced named nothing the operator could see or clear. Removed
      // outright, not replaced with an equivalent check: each `kind`-specific
      // install step below (`finalizeSkillFromLanded` / `finalizeHookFromLanded`
      // / `finalizeTemplateFromLanded`) already 409s on a REAL collision — an
      // existing `skills/<id>/`, `studio/hooks/<id>/`, or template-library
      // entry — naming that real holder, which is the correct enforcement
      // point (see the file header's LANDED-PACKAGE CLEANUP note). The
      // `finally` below now removes the landed copy after every attempt, so
      // `copyStagingToLibrary`'s own O_EXCL write at step 5 never collides
      // with a leftover from an unrelated prior attempt either.

      // Step 5 — run ONE turn on the SAME spine the CLI dispatches to.
      // Dynamically imported so a static import never pulls the Claude Agent
      // SDK into bridge start-up (cli/ui-bridge.ts does not import
      // cli/agent-run.ts today) — mirrors cli/agent-run.ts's own
      // project-brain-builder-runner dynamic-import precedent.
      const descriptor = loadSessionKinds(ctx.forgeRoot).find((d) => d.id === 'authoring');
      if (!descriptor) {
        revert();
        sendJson(res, 500, { error: 'authoring session-kind descriptor not found' }, origin);
        return;
      }
      const { runInteractiveTurn } = await import('../orchestrator/interactive-runner.ts');
      const turnResult: RunInteractiveTurnResult = await runInteractiveTurn(descriptor, {
        sessionId,
        projectRoot,
        forgeRoot: ctx.forgeRoot,
      });
      if (turnResult.phase !== 'committed') {
        // Never report success on an unfinished turn.
        revert();
        sendJson(res, 500, { error: `finalize turn did not reach phase "committed" (got "${turnResult.phase}")` }, origin);
        return;
      }

      // Step 6 — read the LANDED package through the guard and install. The
      // bytes come from here, NEVER from the request body.
      const landedGuard = resolveGuardedPath(ctx.forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id]);
      if (!landedGuard.ok || !landedGuard.exists) {
        revert();
        sendJson(res, 500, { error: 'landed package not found after commit' }, origin);
        return;
      }

      const outcome: InstallOutcome =
        kind === 'skill'
          ? await finalizeSkillFromLanded(ctx.forgeRoot, landedGuard.realPath, id, sessionId)
          : kind === 'hook'
            ? finalizeHookFromLanded(ctx.forgeRoot, id)
            : finalizeTemplateFromLanded(ctx.forgeRoot, id);

      if (!outcome.ok) {
        // Finding 1 x Finding 2 composition: an id collision (or any other
        // install-step refusal) must ALSO leave the session recoverable.
        revert();
        sendJson(res, outcome.status, { error: outcome.error }, origin);
        return;
      }

      // Step 7 — success. `revert` above must NEVER fire on this path.
      //
      // W7-C2 (sessions-kinds-36) — persist the permanent {kind, id} pointer
      // at the object this session produced, so the committed session page
      // can render a durable "Committed as …" link on every later read (the
      // old behaviour navigated ONCE, off this response, and the linkage was
      // lost on reload). Read FRESH (the committing turn itself rewrote
      // status.json to phase 'committed') and best-effort: the package HAS
      // landed and installed — a failed pointer write must never turn that
      // into a reported failure.
      const committedStatus = guardedReadSessionStatus<InteractiveTurnStatus>(projectsRoot, dirSegments);
      if (committedStatus) {
        guardedWriteSessionStatus(projectsRoot, dirSegments, { ...committedStatus, finalized: { kind, id } });
      }
      sendJson(res, 200, { ok: true, kind, id }, origin);
    } catch (err) {
      revert();
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    } finally {
      // library-37 fix — see the file header's LANDED-PACKAGE CLEANUP note:
      // `_interactive-library/<id>/` is removed after EVERY attempt (success
      // OR failure) so the id is never permanently unusable via a leftover
      // ghost. Best-effort and NEVER allowed to mask the outcome already
      // sent above — a cleanup failure (e.g. a transient fs error) leaves the
      // landed copy behind, which is exactly today's pre-fix behaviour, not a
      // NEW failure mode.
      try {
        const cleanupGuard = resolveGuardedPath(ctx.forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id]);
        if (cleanupGuard.ok && cleanupGuard.exists) {
          rmSync(cleanupGuard.realPath, { recursive: true, force: true });
        }
      } catch {
        /* best-effort — see comment above */
      }
    }
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleStudioAuthoringRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  if (url !== FINALIZE_URL) return false;

  const origin = allowedOrigin(req);

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }, origin);
    return true;
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
    return true;
  }

  // The wire contract is EXACTLY {project, sessionId, kind, id} — nothing
  // else is ever read from the body (D5, WI2-4-wire).
  const project = typeof b['project'] === 'string' ? b['project'] : '';
  const sessionId = typeof b['sessionId'] === 'string' ? b['sessionId'] : '';
  const kind = b['kind'];
  const id = typeof b['id'] === 'string' ? b['id'].trim() : '';

  if (!project) {
    sendJson(res, 400, { error: 'project is required' }, origin);
    return true;
  }
  if (!sessionId) {
    sendJson(res, 400, { error: 'sessionId is required' }, origin);
    return true;
  }
  if (kind !== 'skill' && kind !== 'hook' && kind !== 'template') {
    sendJson(res, 400, { error: 'kind is required and must be "skill", "hook", or "template"' }, origin);
    return true;
  }
  if (!id) {
    sendJson(res, 400, { error: 'id is required' }, origin);
    return true;
  }

  await runFinalize(ctx, res, origin, { project, sessionId, kind, id });
  return true;
}
