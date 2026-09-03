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
 *          default. The landed package is otherwise enumerated WHOLE
 *          (`enumerateLandedHookFiles` — every file, recursively, under
 *          `_interactive-library/<id>/`, through the guard): `hook.yaml` is
 *          REWRITTEN from the validated fields (fixed field order, the fixed
 *          relative `script: 'scripts/run.sh'`), and every OTHER staged file
 *          — `scripts/run.sh` included, plus anything else the drafting
 *          agent added (a README, a sourced `scripts/lib.sh`, ...) — is
 *          copied byte-for-byte, through the SAME guarded choke points
 *          `POST /api/studio/hooks` already uses (2026-08-28 hostile-review
 *          fix, counter-repro C / S2: the prior code read exactly the two
 *          hardcoded paths `hook.yaml` and `scripts/run.sh` off the landed
 *          tree and silently dropped every other staged file while still
 *          answering `200 {ok:true}` — an installed hook whose entry script
 *          sourced a dropped sibling died at spawn with exit 127 the first
 *          time it actually ran).
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
 *  REFUSE, NEVER DROP (2026-08-28 hostile-review fix, counter-repro C / S2):
 *  a staged file this route cannot handle — one that fails the landed-package
 *  enumeration's containment/shape checks, or blows the shared
 *  `MAX_PACKAGE_FILES`/`MAX_PACKAGE_BYTES` caps — is a refusal (400, naming
 *  the offending entry), never a silently-dropped subset of the package. The
 *  old two-hardcoded-path `kind:'hook'` shape answered `200 {ok:true}` while
 *  quietly discarding every staged file it didn't happen to read by name;
 *  that shape is gone from every kind this route installs.
 *
 *  CONTAINMENT REFUSALS ARE 4xx, NOT 500 (S3): a NAMED containment refusal
 *  from the copy layer — `InteractiveFinalizerError`, e.g.
 *  `copyStagingToLibrary` refusing a staged symlink/hardlink at step 5 — is
 *  mapped in `runFinalize`'s catch to a clean 400 carrying the finalizer's
 *  own (package-relative, never sanitizeError-mangled) reason, the same way
 *  `SkillIdOccupiedError` is mapped to 409 in `finalizeSkillFromLanded`
 *  above: a caught, expected refusal gets an honest 4xx shape, never the
 *  generic `500 sanitizeError(err)` an unexpected throw still gets.
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
 *
 *  M4 §4 step 2 — carved into `handleAuthoringFinalize`, the one exported
 *  route handler the table `packages/library/routes.ts` assembles. The
 *  sequence above (`runFinalize`) has not moved; what moved is the DISPATCH,
 *  out of this module's own single-arm if-chain and into that table. This
 *  route reads a body, so its ctx is `RouteContext` (`StudioContext` plus
 *  the host-supplied `readBody`) — the legacy body-parsing import is gone.
 * ---------------------------------------------------------------------------
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  type StudioContext,
  type RouteContext,
} from '@forge/kernel';
import { resolveGuardedPath } from '@forge/kernel';
import { resolveProjectsDir, loadConfig, defaultConfigPath } from '@forge/kernel';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from '@forge/sessions/interactive-session.ts';
import { loadSessionKinds } from '@forge/sessions/studio/session-kinds.ts';
// Static import — `interactive-finalizers.ts` imports only `node:fs`,
// `node:path` and the path guard (no Claude Agent SDK), so pulling its named
// error class in here does NOT regress the deliberate dynamic-import-of-the-
// RUNNER decision a few lines below (that import stays dynamic because
// `interactive-runner.ts`, not this module, is what drags the SDK in).
import { InteractiveFinalizerError } from '@forge/sessions/interactive-finalizers.ts';
// Type-only — erased by --experimental-strip-types, so this does NOT pull the
// Claude Agent SDK into bridge start-up. The runtime function is imported
// DYNAMICALLY, inside runFinalize, below (mirrors cli/agent-run.ts's own
// project-brain kind's dynamic-import precedent).
import type { InteractiveTurnStatus, RunInteractiveTurnResult } from '@forge/sessions/interactive-runner.ts';
import { finalizeSkillFromLanded } from './bridge-studio-authoring-skill.ts';
import { finalizeHookFromLanded } from './bridge-studio-authoring-hook.ts';
import { finalizeTemplateFromLanded } from './bridge-studio-authoring-template.ts';
import { INTERACTIVE_LIBRARY_DIRNAME, type InstallOutcome } from './bridge-studio-authoring-types.ts';

export const FINALIZE_URL = '/api/studio/authoring/finalize';

const REQUIRED_PHASE = 'awaiting-review';

// ---------------------------------------------------------------------------
// S3 fix — which InteractiveFinalizerError shapes are an honest, NAMED
// refusal (map to 400 in runFinalize's catch) vs a structural precondition
// failure (stays 500 — see the call site's own comment for why P5-2 pins
// this). `copyStagingToLibrary` (`orchestrator/interactive-finalizers.ts`)
// throws this SAME class for BOTH: every entry-scoped message it emits
// begins with either `staged entry "<path>"` (source-side: containment,
// vanished mid-walk, wrong type, TOCTOU-swap-at-read) or `destination for
// "<path>"` (dest-side: containment, TOCTOU-swap-at-write) — always naming
// the offending package-relative path. The two structural messages
// (`session staging directory is missing or unreadable`, `packageId failed
// containment`) name no single staged entry — there is nothing for the
// operator to fix by editing one file, unlike a symlink/hardlink refusal.
// ---------------------------------------------------------------------------

const ENTRY_SCOPED_FINALIZER_REFUSAL_RE = /^copyStagingToLibrary: (staged entry|destination for) "/;

function isEntryScopedFinalizerRefusal(err: InteractiveFinalizerError): boolean {
  return ENTRY_SCOPED_FINALIZER_REFUSAL_RE.test(err.message);
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
      // project-brain kind's dynamic-import precedent.
      const descriptor = loadSessionKinds(ctx.forgeRoot).find((d) => d.id === 'authoring');
      if (!descriptor) {
        revert();
        sendJson(res, 500, { error: 'authoring session-kind descriptor not found' }, origin);
        return;
      }
      const { runInteractiveTurn } = await import('@forge/sessions/interactive-runner.ts');
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
          ? await finalizeSkillFromLanded(ctx.forgeRoot, landedGuard.realPath, id, sessionId, sanitizeError)
          : kind === 'hook'
            ? finalizeHookFromLanded(ctx.forgeRoot, id, sanitizeError)
            : finalizeTemplateFromLanded(ctx.forgeRoot, id, sanitizeError);

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
      // Step 2 fix (S3) — a NAMED containment refusal from the copy layer
      // (`copyStagingToLibrary` refusing a staged symlink/hardlink/other
      // source-or-destination containment failure at step 5) is an honest,
      // expected refusal, not an unexpected crash — map it to a clean 400
      // exactly the way `SkillIdOccupiedError` is mapped to 409 in
      // `finalizeSkillFromLanded` above, rather than falling through to the
      // generic `500 sanitizeError(err)` below. Built directly from
      // `err.message`, NEVER `sanitizeError`: `InteractiveFinalizerError`
      // messages name only package-relative staged-entry paths
      // ("scripts/evil.sh"), never a host absolute path — there is nothing
      // for `sanitizeError`'s redaction regex to legitimately catch, and
      // running it anyway is exactly what turned "scripts/evil.sh" into the
      // unreadable "scripts[path]".
      //
      // NARROWED to entry-scoped refusals on purpose (`isEntryScopedFinalizerRefusal`
      // below) — `InteractiveFinalizerError` ALSO carries genuinely structural
      // preconditions (a session whose `staging/` dir does not exist at all
      // because the drafting turn crashed before writing anything; an invalid
      // `packageId`, unreachable here in practice because `runFinalizeStep`'s
      // own `SLUG_RE` check throws first) that P5-2 (this same suite) pins as
      // 500 — those are environment/precondition failures the operator
      // recovers from by re-running the drafting turn, not a "here is the one
      // bad file" refusal. Widening the 400 mapping to catch those too would
      // regress that pinned contract for no operator benefit: there is no
      // single offending entry to name.
      if (err instanceof InteractiveFinalizerError && isEntryScopedFinalizerRefusal(err)) {
        sendJson(res, 400, { error: `staged package could not be copied: ${err.message}` }, origin);
        return;
      }
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
// Route handler — POST /api/studio/authoring/finalize. Formerly the sole arm
// of handleStudioAuthoringRoutes (guarded at :471, matched at :474).
// ---------------------------------------------------------------------------

export async function handleAuthoringFinalize(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  if (method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  if (url !== FINALIZE_URL) return false;

  const origin = allowedOrigin(req);

  let body: unknown;
  try {
    body = await ctx.readBody();
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
