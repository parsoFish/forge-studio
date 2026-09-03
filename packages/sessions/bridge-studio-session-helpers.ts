/**
 * bridge-studio-session-helpers.ts — the session-route helper layer, moved once.
 *
 * WHY A SHARED HELPERS MODULE, when that is usually a smell. It is not a grab
 * bag. It is the layer the measurement in `_1.0/plans/M4-sessions-carve-design.md`
 * §2 found underneath every session route family: each symbol here is used by
 * architect AND instructions AND the demo/project-brain/kickoff range, so there
 * is no per-family helper layer to split along. Carving family-by-family would
 * have injected or duplicated this layer three times and migrated it a fourth,
 * minting boundary rows at every intermediate state for routes the PR did not
 * touch. It moves once, whole.
 *
 * WHAT IS DELIBERATELY NOT HERE. Five symbols the families also need stay in
 * `cli/ui-bridge.ts` and are INJECTED at assembly (rulings 13/35/59), because
 * host code that does NOT carve still calls them, and moving them would mint
 * `legacy-to-package` rows in the opposite direction to this milestone's goal:
 * `spawnAgentTurn`, `spawnAgentDispatch` and `SPAWN_AGENT_SPECS` (the host's
 * spawn surface, whose other side is pinned by `session-tail-kind-parity.test.ts`),
 * plus `safeParseJson` (still called by `handleReflect`) and `servedFileHeaders`
 * (still called by `handleHttp`). `@forge/kernel` was checked first and has no
 * equivalent of the latter two — it exports `sendJson` and `parseQuery` (§15.43).
 *
 * The session INDEX collector is not here either: it needs all four families'
 * list functions, so it sits ABOVE this layer, in `bridge-studio-session-index.ts`.
 */
import { randomBytes } from 'node:crypto';
import type { OutgoingHttpHeaders } from 'node:http';

import type { ModelTier } from '@forge/agents/phase-agent.ts';
import { MAX_EXACT_ID_LENGTH, PROJECT_ID_RE } from '@forge/kernel';
import { discoverProjects } from '@forge/kernel/project-layout.ts';
import { isSafeSegment, resolveGuardedPath } from '@forge/kernel/path-guard.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { resolveSessionModel } from '@forge/agents/phase-agent.ts';
import { skillPathRelative } from '@forge/library/skill-path.ts';

import { deriveSessionLifecycleFor, sessionHeartbeatMtimeMs } from './bridge-studio-lifecycle.ts';
import { isTerminalPhase } from './bridge-studio-sessions.ts';
import type { SessionLifecycle } from './bridge-studio-lifecycle.ts';
import { loadSessionKinds } from './studio/session-kinds.ts';
import type { SessionKindDescriptor } from './studio/session-kinds.ts';

/**
 * The slice of the bridge's request context these helpers read.
 *
 * Declared HERE, in this package's own words, rather than importing the host's
 * `HttpContext`: a package that names a host type carries a boundary row
 * whatever the call graph says. Structural typing means the host's real context
 * satisfies this without either side declaring a relationship.
 */
export type ContainmentCheck = (
  candidate: string,
  roots: { forgeRoot: string; projectsRoot: string },
) => boolean;

/**
 * The host's spawn/serve surface, injected at assembly (rulings 13/35/59).
 *
 * Every member stays in `cli/ui-bridge.ts` for a measured reason, not a stylistic
 * one: host code that does NOT carve still calls it, so moving it would mint a
 * `legacy-to-package` row in the opposite direction to this milestone's goal.
 * The types are written in THIS package's words so no rank above sessions is
 * named — structural typing does the rest.
 */
export type SessionHostSurface = {
  /** `spawnAgentTurn` — the detached per-kind runner spawn. */
  readonly spawnAgentTurn: (
    forgeRoot: string,
    agentId: 'architect' | 'instructions' | 'demo-builder' | 'project-brain' | 'authoring' | 'kb-cleanup',
    project: string,
    sessionId: string,
  ) => unknown;
  /** `SPAWN_AGENT_SPECS` — the kind to agent-id/logPrefix mapping whose other
   *  side is pinned by `session-tail-kind-parity.test.ts`. */
  readonly spawnAgentSpecs: Readonly<Record<string, { readonly argvPrefix: readonly string[]; readonly logPrefix: string }>>;
  /** `safeParseJson` — still called by `handleReflect` in the host. */
  readonly safeParseJson: <T>(raw: string) => T | null;
  /** `servedFileHeaders` — still called by `handleHttp` in the host. */
  readonly servedFileHeaders: (filename: string, origin: string) => OutgoingHttpHeaders;
  /** The dry bridge's turn marker. Its kernel move is half-done (`cli/dry-bridge.ts`
   *  still owns this half), so it injects rather than imports — see the s1
   *  outcome §6, which measures four rows that close when that move completes. */
  readonly dryBridgeAgentTurnMarker: (logsRoot: string, route: string, sessionId: string) => Record<string, unknown>;
  /** The shipped containment guard from `@forge/flows`, above this package. */
  readonly isContainedProjectRepoPath: ContainmentCheck;
};

export type SessionRootsContext = {
  readonly forgeRoot: string;
  readonly projectsRoot: string;
  readonly logsRoot: string;
};

/**
 * `GET /api/studio/sessions`' row collector: flattens EVERY registered
 * session kind (`studio/session-kinds.yaml` via `loadSessionKinds` — never a
 * hardcoded kind list, so a new registry kind needs no code change here)
 * across every on-disk project into one row set.
 *
 * The four kinds with their OWN per-kind list route/reader
 * (architect/instructions/demo/project-brain) reuse THAT reader verbatim —
 * `listArchitectSessions` / `listInstructionsSessions` / `listDemoSessions` /
 * `listProjectBrainSessions`, the exact functions `GET /api/architect/
 * sessions` etc. already call — never a second, independently-written scan
 * of the same on-disk shape. Every OTHER kind (onboarding, authoring,
 * kb-cleanup today; any future kind added the same way) has no bespoke list
 * route (bridge-studio-sessions.ts's own header note: the generic
 * session-detail GET is authoring/kb-cleanup's ONLY read route) — those fall
 * through to the generic per-segment-guarded directory scan below, which
 * mirrors `collectSessionRows`'s own directory-enumeration shape immediately
 * above in this file (readdirSync of REAL, on-disk project names — never
 * request-derived — with the per-session STATUS READ routed through the SAME
 * `resolveGuardedPath` choke point every other guarded session read in this
 * file uses).
 *
 * `kind` never comes from a request — every row's `kind` is a registry
 * descriptor id from `loadSessionKinds`, so this route has no kind-id
 * traversal surface at all (unlike the single-session GET, whose `kind` path
 * segment IS request-derived and validated against the registry).
 */
/**
 * W8-A2 (ON-7 defect 1) — the ONE seam every session-list surface routes
 * through to get `{terminal, lifecycle}` for a row: the generic aggregate
 * index's `pushRow` below, AND each of the four bespoke per-kind list
 * routes (`GET /api/architect/sessions` etc.) — so a lifecycle-carrying row
 * can never omit the derivation by forgetting to call
 * `deriveSessionLifecycleFor` inline. Before this fix the four bespoke
 * routes never called `deriveSessionLifecycleFor` at all (imported once,
 * called once, by `pushRow` alone) — this is the wiring fix, not a second
 * derivation: `terminal` + `lifecycle` are computed EXACTLY the way
 * `pushRow` already computed them, just callable from five places instead
 * of copy-pasted or reinvented at four of them.
 */
/**
 * W8-A2 (ON-7) — `staleMs` for the bespoke per-kind session panels: ms since
 * the last sign of life, preferring the runner's OWN signals over the status
 * file's mtime.
 *
 * Order, and why:
 *   1. `.heartbeat` mtime — written only while a runner is genuinely alive,
 *      so it is the strongest positive evidence. Without this, an architect
 *      legitimately sitting in `drafting` for minutes while heartbeating
 *      would raise a FALSE stall warning.
 *   2. the runner's own `updated_at` — its CLAIM about when it last made
 *      progress. This is what the panel has always used, and it is the signal
 *      the flows-run stall cameo exercises.
 *   3. `lifecycle.idleMs` — last resort only.
 *
 * `lifecycle.idleMs` is deliberately NOT the primary source: it is
 * `now - max(status.json MTIME, .heartbeat, events.jsonl)`, and the runner
 * rewrites status.json on every phase transition, so a dead runner whose file
 * was merely touched reads FRESH — a fail-open exactly inverse to this lane's
 * purpose. (Falling back to idleMs also fixes the pre-existing
 * `Date.now() - 0` bug in the old hand-rolled version, which reported ~56
 * years of staleness for an unparseable `updated_at`.)
 */
export function sessionStaleMs(
  ctx: { logsRoot: string },
  kind: string,
  sessionId: string,
  updatedAt: string | undefined,
  lifecycle: SessionLifecycle | null,
): number {
  const now = Date.now();
  const heartbeatMs = sessionHeartbeatMtimeMs(ctx.logsRoot, kind, sessionId);
  if (heartbeatMs !== null) return Math.max(0, now - heartbeatMs);
  const claimed = updatedAt !== undefined ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isNaN(claimed)) return Math.max(0, now - claimed);
  return lifecycle?.idleMs ?? 0;
}
export function deriveRowLifecycle(
  ctx: { projectsRoot: string; logsRoot: string },
  descriptor: SessionKindDescriptor,
  phase: string,
  project: string,
  sessionId: string,
): { terminal: boolean; lifecycle: SessionLifecycle } {
  // Review fix (pre-existing, `pushRow`'s own note): `terminal` is derived
  // FIRST — cheap, and a terminal phase never has an affordance-table row.
  const terminal = isTerminalPhase(descriptor, phase);
  // W7-A2 — ONE lifecycle derivation per row (cli/bridge-studio-lifecycle.ts):
  // phase-row shape (awaits/step, or the legacy tables) + on-disk liveness
  // (stderr.log / .heartbeat / events.jsonl / turn.pid / status.json mtime),
  // computed at read time, never stored.
  const lifecycle = deriveSessionLifecycleFor({
    descriptor, phase, terminal, project, sessionId, projectsRoot: ctx.projectsRoot, logsRoot: ctx.logsRoot,
  });
  return { terminal, lifecycle };
}
/**
 * W8-A2 (ON-7 defect 1, review fix) — `loadSessionKinds` THROWS when
 * `studio/session-kinds.yaml` is missing/unreadable/malformed
 * (`loadSessionKindsSequence`'s own contract, orchestrator/studio/
 * session-kinds.ts). The pre-existing aggregate-index call site
 * (`collectStudioSessionIndexRows` below) accepted that risk unguarded —
 * every REAL forge install always has this file, so it never threw there in
 * practice. The four bespoke per-kind list routes this WI wires
 * `deriveRowLifecycle` into are exercised by many MORE pre-existing test
 * fixtures that never needed the registry before (their routes never called
 * `loadSessionKinds` at all) and do not set it up. An uncaught throw
 * mid-request there is not a clean 500 — none of these four GET handlers
 * wrap their body in try/catch, so the throw left `res.end()` never called
 * and the caller's `fetch()` hanging forever (reproduced: `cli/ui-bridge-
 * architect.test.ts` hung indefinitely against this fix before this
 * helper). Caught HERE, at the one place all four call it, and degrades to
 * "no descriptor resolved" — the SAME graceful "no lifecycle on this row"
 * fallback each route already has for a registry that resolved but simply
 * lacks this kind.
 */
export function findSessionKindDescriptorSafe(forgeRoot: string, kind: string): SessionKindDescriptor | undefined {
  try {
    return loadSessionKinds(forgeRoot).find((d) => d.id === kind);
  } catch {
    return undefined;
  }
}
/**
 * SEC-04 (bd forge-ebj) — the ONE containment choke point for the bridge's
 * request-derived session-dir families (architect / instructions /
 * project-brain / demo). `project` and `sessionId` arrive from request input
 * (a JSON body value OR a decoded URL segment); `kindDirName` is a fixed
 * literal (`_architect` / `_instructions` / `_project-brain` / `_demo`). Each
 * untrusted value is passed as its OWN element of `resolveGuardedPath`'s
 * `segments[]` (cli/studio-path-guard.ts) — NEVER folded into `root` — so the
 * per-segment IDENTITY walk catches every escape shape from the
 * adversarial-containment-review catalogue: a `/`-, `.`- or `..`-laden segment,
 * a symlinked `<project>` / `_<kind>` / `<sessionId>`, a cross-object same-root
 * alias, and a hardlinked leaf.
 *
 * Returns the fully-resolved, contained dir, or `null` on ANY escape — a
 * missing dir and an escaping symlink both collapse to `null`, so the caller's
 * response is indistinguishable between "wrong id" and "blocked escape" (no
 * oracle). The leaf may legitimately NOT exist yet (the `/start` create case),
 * so existence is NOT required here; every read route separately returns 404
 * when its `status.json` / file is subsequently found absent, and every write
 * route mkdirs under a dir this function already proved contained.
 */
export function guardedSessionDir(
  projectsRoot: string,
  project: string,
  kindDirName: string,
  sessionId: string,
): string | null {
  const guarded = resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId]);
  return guarded.ok ? guarded.realPath : null;
}
/** Longest rendering of a rejected value echoed back in a 400. */
const MAX_REJECTED_VALUE_CHARS = 200;

/** Renders an untrusted, non-string value for a 400 body: never throws, never
 *  unbounded. The `?? String(candidate)` arm covers the values whose
 *  `JSON.stringify` is `undefined` rather than a string. */
function describeRejectedValue(candidate: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(candidate) ?? String(candidate);
  } catch {
    rendered = '<unrepresentable value>';
  }
  if (rendered.length <= MAX_REJECTED_VALUE_CHARS) return rendered;
  return `${rendered.slice(0, MAX_REJECTED_VALUE_CHARS)}… (${rendered.length} chars, truncated)`;
}
/**
 * R4-16 PIN 4/5 (SEC-02, forge-d1f) — the COMPLETE set of `/start`-family
 * routes that accept a caller-supplied `projectRepoPath`: `/api/architect/start`,
 * `/api/instructions/start`, `/api/demo-builder/start`, and
 * `/api/project-brain/start`. Each persists it verbatim into the session's
 * `status.json` as `project_repo_path`. That field becomes the agent's
 * `cwd`, the target of real `git` branch-create + commit calls, and the base
 * for every artifact write — reproduced live: an unvalidated field served a
 * planted sentinel outside the forge tree and let a forged status write real
 * artifacts into an arbitrary git repo. This comment is the complete
 * enumeration — a future `/start`-family route accepting this field MUST
 * wire this same guard before any read/write/status-persist, not just add
 * itself to this list.
 *
 * Reuses the SHIPPED guard (`isContainedProjectRepoPath`,
 * `cli/manifest-path-guard.ts`) rather than a new check — same choke point
 * `cli/bridge-recovery.ts` already uses for `worktree_path` /
 * `project_repo_path` on the recovery routes. Returns the offending value
 * (so the caller can name it in the 400) when present-but-not-contained,
 * `null` when absent or genuinely contained under `<forgeRoot>/projects/`.
 *
 * Finding B: `''` is treated as absent here, matching every call site's
 * `body.projectRepoPath || join(ctx.projectsRoot, body.project)` default —
 * `??` does NOT substitute for `''`, so every call site MUST use `||`, never
 * `??`, for this field.
 *
 * Finding C: `candidate` is `unknown`, not `string | undefined` — the
 * request body is untrusted JSON and the static type is a lie about what
 * can actually arrive at runtime. A non-string value (e.g. `0`, `null`,
 * `{}`) must fail closed with a 400 naming it, rather than falling through
 * to `isAbsolute()` and leaking a raw Node `TypeError [ERR_INVALID_ARG_TYPE]`.
 *
 * PRECONDITION (load-bearing, stated because a future caller will otherwise
 * break it silently): `candidate` is `JSON.parse` output from a request body.
 * That is what makes the value space closed — string / number / boolean /
 * null / array / object, never a BigInt, Symbol, circular structure or a
 * hostile `toJSON`. This function is deliberately NOT exported; feeding it
 * from a non-JSON source would reopen shapes `describeRejectedValue` cannot
 * be assumed to survive.
 */
function invalidProjectRepoPath(
  candidate: unknown,
  roots: { forgeRoot: string; projectsRoot: string },
  isContained: ContainmentCheck,
): string | null {
  if (candidate === undefined || candidate === '') return null;
  if (typeof candidate !== 'string') return describeRejectedValue(candidate);
  return isContained(candidate, roots) ? null : candidate;
}

/**
 * The `/start`-family repo-path guard — the ONLY way into the predicate above.
 *
 * WHY THIS EXISTS RATHER THAN AN EXPORTED `invalidProjectRepoPath`. That
 * function's own comment states a load-bearing precondition: its `candidate` is
 * `JSON.parse` output from a request body, and *that* is what makes its value
 * space closed. It says, verbatim, that it "is deliberately NOT exported;
 * feeding it from a non-JSON source would reopen shapes `describeRejectedValue`
 * cannot be assumed to survive."
 *
 * The carve could not honour that literally — measured, its four callers are the
 * four `/start` routes and they live in three different family modules, so no
 * one module can hold it privately. Exporting the raw predicate would have
 * widened exactly the value space the comment protects. So the invariant is kept
 * STRUCTURALLY instead of by convention: this function takes the parsed request
 * BODY and reads the field off it itself, so the call shape the comment fears —
 * handing the predicate a value from somewhere that is not a request body — does
 * not exist in the exported surface. `bridge-studio-session-helpers.test.ts`
 * pins that this module's exports do not include the raw predicate.
 *
 * All four call sites were byte-identical before the carve; they were one shared
 * guard already, written out four times.
 *
 * `isContained` is passed in rather than imported: the shipped containment guard
 * lives in `@forge/flows`, which is ABOVE this package, and `check-boundaries`
 * runs with `tsPreCompilationDeps: true` — so naming it even in type position
 * would mint a row. The host supplies it at assembly (rulings 13/35/59).
 */
export function rejectStartProjectRepoPath(
  body: { readonly projectRepoPath?: unknown },
  roots: { forgeRoot: string; projectsRoot: string },
  isContained: ContainmentCheck,
): string | null {
  return invalidProjectRepoPath(body.projectRepoPath, roots, isContained);
}
/**
 * Wave-6 kickoff model-tier seam (ADR-043 §3 amendment, 2026-08-15) — the
 * COMPLETE set of `/start`-family routes that accept an optional
 * caller-supplied `modelTier`: `/api/architect/start`,
 * `/api/instructions/start`, `/api/project-brain/start`,
 * `/api/demo-builder/start`, `/api/studio/authoring/start`,
 * `POST /api/studio/kbs/:id/cleanup/start`. Each MUST validate it through
 * this helper BEFORE any mkdir/status write, and persist the returned
 * `tier` (when present) verbatim into the session's initial `status.json`
 * as `modelTier` — every turn runner (the four legacy runners +
 * `runInteractiveTurn`) reads it back from there and resolves it through
 * `resolveSessionModel` on EVERY turn (ADR 024's SKILL.md-is-the-envelope
 * contract, not just at kickoff).
 *
 * The allowed set is derived from the agent's OWN `SKILL.md` (via
 * `deriveAgentSpec` + `resolveSessionModel`) — NEVER a client-supplied list
 * — so a request naming a tier outside the skill's declared envelope
 * (`strategy:range`'s `range:`, or the single tier a `strategy:fixed` skill
 * pins) is rejected naming both the offending value and the real allowed
 * set, exactly per `resolveSessionModel`'s own error contract. Never trust a
 * wider set than the skill itself declares.
 *
 * `candidate` is `unknown`, not `string | undefined` — same untrusted-JSON
 * discipline as `invalidProjectRepoPath` above (request bodies are `JSON.parse`
 * output, so a non-string `modelTier` — `0`, `null`, `{}` — is a real shape
 * that must fail closed with a 400 naming it, not a raw `TypeError`).
 */
/**
 * W7-B6 (sessions-kinds-02 / projects-15 / crosscut-21): a kickoff `project`
 * must name a DISCOVERED project. Every session /start route used to accept
 * any string — the containment guards tolerate a not-yet-existing segment
 * (creation mode), so a typo minted `projects/<typo>/_<kind>/<sid>/` and the
 * phantom then appeared on /projects as a real project card (and, for the
 * architect, spawned a real agent turn against it). Returns the 404 reason,
 * or `null` when the project is in the roster. The KB-anchored kind
 * (kb-cleanup's `.kb-<id>`) has its own anchor rules and never passes
 * through this check.
 */
export function unknownProjectReason(ctx: SessionRootsContext, candidate: unknown): string | null {
  // NON-STRING shapes and containment-rejected strings (traversal, "..",
  // separators, control chars — everything `isSafeSegment` refuses) stay
  // each route's own (pre-existing, PINNED) 400 contracts — they fall
  // THROUGH this check so those guards keep firing exactly as before. But a
  // string isSafeSegment ACCEPTS that still fails PROJECT_ID_RE is the
  // creation-mode GAP (W7-B6 review F1): spaces, interior dots, leading
  // "_"/"."/"-" all pass the containment guard, so "my project" or
  // ".hidden" minted a phantom projects/<junk>/ (and, for the architect,
  // spawned a paid agent turn) straight past the roster check — those are
  // refused HERE. `invalidGenerationProjectReason` is the ONE project-id
  // shape rule (length cap THEN charset, value interpolation bounded),
  // reused rather than re-declared.
  if (typeof candidate !== 'string') return null;
  if (isSafeSegment(candidate)) {
    const invalidShape = invalidGenerationProjectReason(candidate);
    if (invalidShape !== null) return invalidShape;
  } else {
    return null; // the downstream containment guard's own pinned 400 fires
  }
  const known = discoverProjects(ctx.projectsRoot, ctx.forgeRoot).some((p) => p.id === candidate);
  return known ? null : `unknown project "${candidate}" — not in the project roster (onboard it at /projects/new first)`;
}
export function resolveKickoffModelTier(
  agentSlug: string,
  candidate: unknown,
): { ok: true; tier: ModelTier | undefined } | { ok: false; error: string } {
  if (candidate === undefined) return { ok: true, tier: undefined };
  if (typeof candidate !== 'string') {
    return { ok: false, error: `modelTier must be a string (got ${describeRejectedValue(candidate)})` };
  }
  try {
    const spec = deriveAgentSpec(skillPathRelative(agentSlug));
    resolveSessionModel(spec, candidate as ModelTier);
    return { ok: true, tier: candidate as ModelTier };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
export function newArchitectSessionId(): string {
  // YYYY-MM-DDTHH-mm-ss (matches ArchitectSession.session_id elsewhere) plus
  // an 8-hex-char entropy suffix (R4-17 round-3 BLOCKER pin 5, item 1, close
  // 3): the timestamp alone has only ONE-SECOND granularity — zero entropy —
  // so a session id was guessable well enough to pre-plant a colliding
  // directory (reproduced live, 100% hit rate over a 4-second candidate
  // window; see cli/ui-bridge-onboarding-start.test.ts AT-13/14/15/17). This
  // helper is shared by FIVE routes (architect / instructions /
  // project-brain / demo-builder / onboarding start) and nothing downstream
  // string-matches the bare timestamp shape — only SAFE_ID_RE plus a length
  // cap gate it — so fixing it here fixes all five in one place rather than
  // only the caller that happened to get adversarially reviewed.
  //
  // Hex digits are a subset of SAFE_ID_RE's charset ([A-Za-z0-9_-]), and the
  // fixed-width timestamp prefix still sorts chronologically across
  // different seconds (the entropy suffix only breaks ties WITHIN the same
  // second, where finer ordering was never a guarantee anyway).
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');
  const entropy = randomBytes(4).toString('hex');
  return `${stamp}-${entropy}`;
}
function invalidGenerationProjectReason(id: string): string | null {
  if (id.length > MAX_EXACT_ID_LENGTH) {
    return `invalid project "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_EXACT_ID_LENGTH}-character length limit`;
  }
  // W7-A4: the ONE project-id rule (case-preserving directory name, exact).
  if (!PROJECT_ID_RE.test(id)) {
    return `invalid project "${id}" — must match ${PROJECT_ID_RE} (the project's directory name: one path segment; no "/", "\\", ".", "..", or a leading "-")`;
  }
  return null;
}