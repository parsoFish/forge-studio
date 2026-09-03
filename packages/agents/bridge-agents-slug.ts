/**
 * bridge-agents-slug.ts — the two `/api/agents/:slug/*` routes, and the
 * materials validation only the run route uses.
 *
 * Carved out of `cli/ui-bridge.ts` (M4-agents, exit row 2). Every symbol here
 * was checked for uses outside the agent surface before it moved: the whole
 * materials cluster (`MATERIAL_FILENAME_RE`, the three message builders,
 * `decodeStrictBase64`, `validateMaterialsField`) had none.
 *
 * TWO CONSTANTS DID NOT SIMPLY MOVE, and the difference matters.
 *
 * `SAFE_AGENT_SLUG_RE` is exported rather than kept private, because the host's
 * `spawnAgentDispatch` — sessions' kickoff routes hold the same reference, so it
 * stays in `cli/ui-bridge.ts` — applies the same refusal. ONE definition,
 * imported by the host, rather than two copies of a defense-in-depth guard that
 * would drift. And note what it is NOT: `@forge/kernel`'s `SLUG_RE` is
 * `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`, which requires a leading LETTER and
 * forbids doubled or trailing hyphens; this one allows a leading digit and both
 * hyphen shapes. They are different rules, so collapsing them here would
 * TIGHTEN validation on two live routes — a real decision, and not one a carve
 * gets to make silently. Recorded as a finding, carried verbatim.
 *
 * `SAFE_PROJECT_NAME_RE` was a bare alias of `PROJECT_ID_RE` kept, in its own
 * words, "so the existing call site reads unchanged". The call site moved, so
 * the alias is gone and the one project-id rule is imported from `@forge/kernel`
 * directly — the owner, not a re-export detour (COMMON §15.43).
 *
 * The body arrives as `ctx.readBody()` (T1 ruling 30): the host still owns the
 * CSRF and transport policy and hands the RESULT down. `GET /:slug/history`
 * never calls it, because it has no body to read.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  allowedOrigin, createLogger, guardedFile, sanitizeError, sendJson,
  MAX_KICKOFF_COST_CEILING_USD, PROJECT_ID_RE, type RouteContext,
} from '@forge/kernel';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

import { skillsDir } from './skill-path.ts';
import { isSafeRunId } from './run-agent.ts';
import { resolveDispatchableAgent } from './agent-dispatch.ts';
import { listAgentDefinitions } from './studio/agent-registry.ts';
import { unreadyConnectionsFor, formatUnreadyConnections } from './studio/connection-run-gate.ts';
import { stageMaterials, MaterialsStagingError } from './materials-staging.ts';
import {
  MAX_MATERIALS_COUNT, MAX_MATERIAL_BYTES, MAX_MATERIALS_TOTAL_BYTES,
  materialKindForFilename, agentAcceptsMaterial,
} from './studio/materials.ts';
import type { AgentHistoryRow } from './bridge-agents-run-state.ts';
import {
  collectFlowNodeRows, collectStandaloneRows, collectSessionRows,
  type AgentHistoryDeps,
} from './bridge-agents-history-rows.ts';

/**
 * What these two routes need from above this package's rank, plus the bridge
 * instance state. `spawnAgentDispatch`, `newRunStamp` and `safeInputKeyRe` are
 * INJECTED rather than moved: `packages/sessions/bridge-studio-kickoff.ts`
 * holds the same three references through `SessionsRouteDeps`, and moving them
 * would break its routes silently.
 */
export type AgentSlugRouteDeps = AgentHistoryDeps & {
  projectsRoot: string;
  safeInputKeyRe: RegExp;
  newRunStamp(): string;
  /** The host's `spawnAgentDispatch`, positionally identical — sessions'
   *  kickoff routes hold this same reference, so its shape is not ours to
   *  reshape on the way past. */
  spawnAgentDispatch(
    forgeRoot: string, slug: string, runId: string, project?: string,
    inputs?: Record<string, string>, sessionDir?: string,
    costCeilingUsd?: number, projectsRoot?: string,
  ): void;
  dryBridgeAgentTurnMarker(logsRoot: string, route: string, runId: string): Record<string, unknown>;
  ensureAgentRunTail(runId: string): void;
};

type Handler = (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => Promise<boolean>;


/** Studio agent slug shape (skill dir names): lowercase alnum + hyphen, no
 *  leading hyphen (so a flag-shaped slug can't reach a detached spawn even from
 *  a future caller that skips roster resolution). The TRUE injection guard is
 *  `resolveDispatchableAgent` rejecting non-roster slugs + argv-array/no-shell
 *  spawn semantics; this regex is defense-in-depth, not the sole barrier. */
export const SAFE_AGENT_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
/** R6-04-F2 WI-1 contract point 3 — a `materials:` upload's `filename` must
 *  be a single safe path-segment NAME: alnum-first (bans dotfiles like
 *  `.env` and the `..foo`/`.`/`..` shapes outright — no traversal token is
 *  needed for any of those to be refused), then alnum plus SPACE, `.`, `_`,
 *  `-`, `(`, `)`, `[`, `]` (no `/`, no `\`, no `%`, no NUL/control chars,
 *  never decoded — this field is a JSON string VALUE, never a URL segment),
 *  max 128 chars total.
 *
 *  ROUND 3 WIDENING (adversarial review): the original class
 *  (`[A-Za-z0-9._-]` only) rejected the filenames operators' own machines
 *  produce by DEFAULT — `Screen Shot 2026-08-07 at 10.32.15 AM.png` (macOS
 *  screenshot), `data (1).csv` (browser duplicate-download suffix),
 *  `Meeting Notes.pdf` — on this feature's headline use case (attaching a
 *  screenshot). Space/`(`/`)`/`[`/`]` were added to the TAIL class only; the
 *  leading-character rule, the length cap, and every excluded character
 *  (`/`, `\`, `%`, NUL, control chars) are UNCHANGED from round 1/2.
 *
 *  ATTACK-THE-FIX (personally attempted before accepting this widening, not
 *  just watched pass): a literal `..` substring embedded via the newly
 *  allowed brackets/parens (e.g. `photo [..] (backup)..png`) is safe and
 *  correctly ACCEPTED — there is no `/` anywhere, so it is one opaque
 *  segment name, never a path boundary, exactly `studio-path-guard.ts`'s own
 *  established `..foo`-is-legitimate precedent; `/`, `\`, `%`, NUL, and
 *  control characters are all still excluded by the class itself (adding
 *  space/parens/brackets to the tail did not touch the exclusion list); a
 *  name that is only dots/spaces (no alnum at all) is still refused by the
 *  alnum-first rule, unchanged.
 *
 *  Deliberately STILL ASCII-only — non-ASCII (e.g. `résumé.pdf`) is REFUSED,
 *  not an oversight of the widening: filesystem unicode normalization
 *  differs by platform (macOS tends toward NFD, Linux does not), so one
 *  logical name can be two different on-disk byte sequences, and
 *  `resolveGuardedPath`'s realpath-identity comparison would behave
 *  differently per platform for the SAME input — fail-closed-and-consistent
 *  beats convenient-and-platform-dependent.
 *
 *  Deliberately STRICTER than, and NOT reused from, `studio-path-guard.ts`'s
 *  `isSafeSegment` (which allows `..foo` but not space/parens/brackets at
 *  all) — this is a narrower, purpose-built contract for an untrusted
 *  upload name, not a relaxation of the shared guard's rule. */
const MATERIAL_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ()._[\]-]{0,127}$/;

/** Comma-separated, declaration-order rendering of an agent's declared
 *  materials kinds for a refusal message — the literal `(none)` when the
 *  agent declares nothing at all (R6-04-F2 WI-1, exact wording pinned by
 *  `cli/ui-bridge-agent-run-materials.test.ts`). */
function declaredMaterialKindsClause(declared: readonly string[]): string {
  return declared.length > 0 ? declared.join(', ') : '(none)';
}

/** Exact refusal text for a filename whose extension derives NO material
 *  kind at all (`materialKindForFilename` returned `undefined`). Wording is
 *  pinned character-for-character by the acceptance tests — do not reword. */
function materialsNoKindMessage(filename: string, slug: string, declared: readonly string[]): string {
  return `materials: "${filename}" maps to no material kind; agent "${slug}" declares: ${declaredMaterialKindsClause(declared)}`;
}

/** Exact refusal text for a filename that DOES derive a kind, but one the
 *  agent has not declared (`agentAcceptsMaterial` returned `false`). Wording
 *  is pinned character-for-character by the acceptance tests — do not
 *  reword. */
function materialsUndeclaredKindMessage(filename: string, kind: string, slug: string, declared: readonly string[]): string {
  return `materials: "${filename}" is ${kind}; agent "${slug}" declares: ${declaredMaterialKindsClause(declared)}`;
}

/** Decode `raw` as base64 and require it to ROUND-TRIP back to the exact
 *  same string. Node's base64 decoder is lenient — it silently drops stray
 *  invalid characters instead of throwing — so "does `Buffer.from` throw"
 *  is not a valid validity check on its own; only a successful round-trip
 *  proves `raw` was genuinely, exactly base64. Returns `undefined` (never
 *  throws) on any mismatch. */
function decodeStrictBase64(raw: string): Buffer | undefined {
  const buf = Buffer.from(raw, 'base64');
  return buf.toString('base64') === raw ? buf : undefined;
}

type ValidatedMaterial = { filename: string; bytes: Buffer; kind: string };
type MaterialsValidation = { ok: true; entries: ValidatedMaterial[] } | { ok: false; error: string };

/**
 * Validate one `POST /api/agents/:slug/run` request body's `materials`
 * field end to end (R6-04-F2 WI-1, contract points 2-8): shape, filename
 * charset, duplicate-within-request, strict base64, the three caps, and —
 * the headline behaviour — the kind gate itself. The kind for every entry
 * is derived SERVER-SIDE via `materialKindForFilename`; nothing here ever
 * reads a client-supplied `kind` field, so one can never influence the
 * outcome in either direction (acceptance test: a lying `kind` can neither
 * bypass the gate nor cause a false refusal).
 *
 * Pure and synchronous — no filesystem I/O, no partial state. Returns
 * either the fully-validated, decoded entries ready for `stageMaterials`,
 * or a single `error` string ready to send as a 400. `materials` absent (or
 * `[]`) returns `{ ok: true, entries: [] }` — contract point 1,
 * byte-identical to today's behaviour.
 */
export function validateMaterialsField(rawMaterials: unknown, def: AgentDefinition): MaterialsValidation {
  if (rawMaterials === undefined) return { ok: true, entries: [] };
  if (!Array.isArray(rawMaterials)) {
    return { ok: false, error: 'materials: must be an array' };
  }
  if (rawMaterials.length > MAX_MATERIALS_COUNT) {
    return { ok: false, error: `materials: at most ${MAX_MATERIALS_COUNT} materials per request (got ${rawMaterials.length})` };
  }

  const declared = def.materials ?? [];
  const seenFilenames = new Set<string>();
  const entries: ValidatedMaterial[] = [];
  let totalBytes = 0;

  for (const raw of rawMaterials) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'materials: each entry must be an object with filename and contentBase64' };
    }
    const entry = raw as Record<string, unknown>;

    if (typeof entry.filename !== 'string') {
      return { ok: false, error: 'materials: filename must be a string' };
    }
    const filename = entry.filename;
    if (!MATERIAL_FILENAME_RE.test(filename)) {
      return { ok: false, error: `materials: invalid filename ${JSON.stringify(filename)}` };
    }
    if (typeof entry.contentBase64 !== 'string') {
      return { ok: false, error: `materials: "${filename}" contentBase64 must be a string` };
    }
    if (seenFilenames.has(filename)) {
      return { ok: false, error: `materials: duplicate filename "${filename}" in one request` };
    }
    seenFilenames.add(filename);

    const bytes = decodeStrictBase64(entry.contentBase64);
    if (!bytes) {
      return { ok: false, error: `materials: "${filename}" contentBase64 is not valid base64` };
    }
    if (bytes.length > MAX_MATERIAL_BYTES) {
      return { ok: false, error: `materials: "${filename}" exceeds the per-file size cap (${MAX_MATERIAL_BYTES} bytes)` };
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_MATERIALS_TOTAL_BYTES) {
      return { ok: false, error: `materials: total size exceeds the request cap (${MAX_MATERIALS_TOTAL_BYTES} bytes)` };
    }

    const kind = materialKindForFilename(filename);
    if (!kind) {
      return { ok: false, error: materialsNoKindMessage(filename, def.slug, declared) };
    }
    if (!agentAcceptsMaterial(def, kind)) {
      return { ok: false, error: materialsUndeclaredKindMessage(filename, kind, def.slug, declared) };
    }

    entries.push({ filename, bytes, kind });
  }

  return { ok: true, entries };
}

/**
 * W7-B5 (agents-02): an empty or shape-invalid slug is a CLIENT BUG, not a
 * filter that happens to match nothing — the RunPanel used to fire
 * `GET /api/agents//history` on every mount and this route answered 200.
 */
export const handleAgentHistory = (deps: AgentSlugRouteDeps): Handler => async (req, res, ctx) => {
  const origin = allowedOrigin(req);
  const url = req.url ?? '';
  let slug: string;
  try {
    slug = decodeURIComponent(url.slice('/api/agents/'.length, url.length - '/history'.length));
  } catch {
    sendJson(res, 400, { error: 'invalid agent slug (malformed percent-encoding)' }, origin);
    return true;
  }
  // W7-B5 (agents-02): an empty or shape-invalid slug is a CLIENT BUG, not
  // a filter that happens to match nothing — the RunPanel used to fire
  // `GET /api/agents//history` on every mount and this route answered 200.
  // Same validator the POST /run route applies to the same path segment.
  if (!SAFE_AGENT_SLUG_RE.test(slug)) {
    sendJson(res, 400, { error: `invalid agent slug: ${JSON.stringify(slug)}` }, origin);
    return true;
  }
  try {
    const rows: AgentHistoryRow[] = [
      ...collectFlowNodeRows(deps, ctx.forgeRoot, slug),
      ...collectStandaloneRows(deps, ctx.logsRoot, slug),
      ...collectSessionRows(deps, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot, projectsRoot: deps.projectsRoot }, slug),
    ];
    sendJson(res, 200, { ok: true, rows }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
};

/** `POST /api/agents/:slug/run` — the standalone dispatch. */
export const handleAgentRunStart = (deps: AgentSlugRouteDeps): Handler => async (req, res, ctx) => {
  const origin = allowedOrigin(req);
  const url = req.url ?? '';
  const slug = decodeURIComponent(url.slice('/api/agents/'.length, url.length - '/run'.length));
  if (!SAFE_AGENT_SLUG_RE.test(slug)) {
    sendJson(res, 400, { error: `invalid agent slug: ${JSON.stringify(slug)}` }, origin);
    return true;
  }
  try {
    const body = (await ctx.readBody()) as { project?: unknown; inputs?: unknown; materials?: unknown; costCeilingUsd?: unknown };
    // Resolve + validate against the live roster (unknown/interactive → 400).
    let def: ReturnType<typeof resolveDispatchableAgent>;
    try {
      def = resolveDispatchableAgent(slug, listAgentDefinitions(skillsDir(ctx.forgeRoot)));
    } catch (err) {
      sendJson(res, 400, { error: sanitizeError(err) }, origin);
      return true;
    }
    // W7-B5 (agents-21): a 'ralph'-strategy agent cannot run standalone at
    // all — `runAgent` refuses multi-iteration loops (orchestrator-band),
    // so pre-B5 this route happily minted a run that then always died with
    // agent-dispatch.failed. Refuse HERE, before any run dir exists, with
    // the honest reason the UI can show next to the Run control.
    if (def.runtime.loopStrategy === 'ralph') {
      sendJson(
        res,
        400,
        {
          error:
            `agent "${slug}" declares loopStrategy 'ralph' — multi-iteration loops run inside the develop flow ` +
            `(orchestrator-band), never as a standalone dispatch. Start it through its flow instead.`,
        },
        origin,
      );
      return true;
    }
    // R3-04 D9.2 — pre-spawn connection-readiness refusal, BEFORE
    // spawnAgentDispatch is ever called: same shared derivation
    // (`unreadyConnectionsFor`/`formatUnreadyConnections`,
    // `orchestrator/studio/connection-run-gate.ts`) as run-agent.ts's own
    // D9.1 gate — one vocabulary, not a second one open-coded here. A
    // blocked response carries neither `ok` nor `runId`: nothing was
    // dispatched.
    const unready = unreadyConnectionsFor(ctx.forgeRoot, def);
    if (unready.length > 0) {
      sendJson(res, 409, { error: formatUnreadyConnections(def, unready) }, origin);
      return true;
    }
    let project: string | undefined;
    if (body.project !== undefined) {
      if (typeof body.project !== 'string' || !PROJECT_ID_RE.test(body.project)) {
        sendJson(res, 400, { error: `invalid project: ${JSON.stringify(body.project)}` }, origin);
        return true;
      }
      if (!guardedFile(deps.projectsRoot, [body.project], 'readdir')) {
        sendJson(res, 404, { error: `project not found: ${body.project}` }, origin);
        return true;
      }
      project = body.project;
    }
    // inputs: a flat string→string map, rendered as prompt DATA by
    // dispatchAgentRun. Validate KEYS too — an invalid key must 400, never be
    // silently dropped downstream in spawnAgentDispatch (this repo bans
    // swallowed failures: a dropped input the operator never learns about).
    const inputs: Record<string, string> = {};
    if (body.inputs !== undefined) {
      if (typeof body.inputs !== 'object' || body.inputs === null || Array.isArray(body.inputs)) {
        sendJson(res, 400, { error: 'inputs must be an object of string values' }, origin);
        return true;
      }
      for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>)) {
        if (!deps.safeInputKeyRe.test(k)) {
          sendJson(res, 400, { error: `invalid input key: ${JSON.stringify(k)} (expected ${deps.safeInputKeyRe})` }, origin);
          return true;
        }
        if (typeof v !== 'string') {
          sendJson(res, 400, { error: `input "${k}" must be a string` }, origin);
          return true;
        }
        inputs[k] = v;
      }
    }
    // R6-04 WI-2 — the per-kickoff cost ceiling. Fail-closed, THREE ordered
    // stages (round 8, T1 ruling on validation precedence):
    //   1. shape/type — non-number or non-finite. Must win over everything
    //      else: we should never reason about whether a malformed value is
    //      "enforceable" or "in bounds".
    //   2. enforceability — a property of the AGENT, invariant under the
    //      value (only `runtime.loopStrategy: 'one-shot'` agents can honor
    //      a ceiling via options.maxBudgetUsd, orchestrator/run-agent.ts's
    //      runOneShotSpawn; the legacy invocation path, 14 of 19 real
    //      dispatchable roster agents, has no budget concept at all). This
    //      wins over bounds: a bounds message ("must be <= N") implies "use
    //      a smaller number" as a remedy, but for a legacy-path agent NO
    //      value is acceptable — a message naming an unusable remedy is
    //      actively misleading. Mirrors the SAME guard `runAgent` itself
    //      enforces (defense-in-depth: this route is not the only entry
    //      point — `forge agent dispatch --cost-ceiling-usd` never passes
    //      through it).
    //   3. bounds — a property of the VALUE: <= 0 or above
    //      MAX_KICKOFF_COST_CEILING_USD. Exactly-at-the-max is accepted
    //      (inclusive boundary); one unit over is refused.
    // All three 400 BEFORE runId is minted / spawnAgentDispatch is ever
    // called — no run is spawned on a refused ceiling.
    let costCeilingUsd: number | undefined;
    if (body.costCeilingUsd !== undefined) {
      const v = body.costCeilingUsd;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        sendJson(
          res,
          400,
          { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
          origin,
        );
        return true;
      }
      // W7-B5 (agents-21): the legacy invocation path (absent loopStrategy)
      // now ENFORCES a ceiling (adapter maxBudgetUsdPerIteration — see
      // orchestrator/run-agent.ts runInvocationSpawn), so only an UNKNOWN
      // declared strategy is refused here ('ralph' was already refused
      // above, before the ceiling was ever considered).
      if (def.runtime.loopStrategy !== undefined && def.runtime.loopStrategy !== 'one-shot') {
        sendJson(
          res,
          400,
          {
            error:
              `costCeilingUsd: ceiling not enforceable for this agent's loop strategy ` +
              `(agent "${slug}" declares ${JSON.stringify(def.runtime.loopStrategy)} — an operator ` +
              `cost ceiling is enforced for loopStrategy 'one-shot' and for the legacy invocation path)`,
          },
          origin,
        );
        return true;
      }
      if (v <= 0 || v > MAX_KICKOFF_COST_CEILING_USD) {
        sendJson(
          res,
          400,
          { error: `invalid costCeilingUsd: ${JSON.stringify(v)} (must be a finite number > 0 and <= ${MAX_KICKOFF_COST_CEILING_USD})` },
          origin,
        );
        return true;
      }
      costCeilingUsd = v;
    }
    // R6-04-F2 WI-1 — materials contract enforcement, the agent-kickoff
    // upload seam. ALL validation happens here, alongside `inputs` above,
    // BEFORE `runId` is minted below: a refused request never reaches the
    // point where a run directory could exist at all, which is what makes
    // "nothing written on refusal" true BY CONSTRUCTION rather than by a
    // compensating delete. `def` (the agent's declared `materials:`) is
    // already resolved above; the kind for every entry is derived
    // SERVER-SIDE (`materialKindForFilename`) — a client-supplied `kind`
    // field, if present, is never read.
    const materialsValidation = validateMaterialsField(body.materials, def);
    if (!materialsValidation.ok) {
      sendJson(res, 400, { error: materialsValidation.error }, origin);
      return true;
    }
    const runId = `_agent-${slug}-${deps.newRunStamp()}`;
    // Guard symmetry, hoisted (W7-B5): the t0 marker below is now the FIRST
    // thing that writes under `runId` (`createLogger` does
    // `resolve(logsRoot, runId)` + `mkdirSync`), so the server-minted-id
    // safety check this file applies to this SAME value at its other sites
    // (spawnAgentDispatch, the run-status route, the staging mkdir below)
    // has to run BEFORE it — otherwise the very first write is the one that
    // skips the check. A server-minted id failing its own safety check is a
    // server anomaly, not a client mistake, so it raises to the route's
    // existing 500 path, never a 400.
    if (!isSafeRunId(runId)) {
      throw new Error('refused to dispatch — unsafe server-minted run id');
    }
    // W7-B5 (agents-20 / agents-31 / sessions-kinds-24 sibling): the run's
    // FIRST event lands the moment the id is minted — so `GET
    // /api/events/<runId>` is 200 at t0 (no console 404 on the drawer's
    // first fetch), the history route can attribute the run to its slug
    // even if the child dies before runAgent's own `start` event, and the
    // ceiling in force is durable from the moment it was accepted (a
    // failed/still-running run can still surface it). `skill: slug` is the
    // D4 identity field. Emitted BEFORE materials staging so the log reads
    // in real order: dispatched → materials-staged → (child lifecycle).
    createLogger(runId, ctx.logsRoot).emit({
      initiative_id: runId,
      phase: 'orchestrator',
      skill: slug,
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'agent-run.dispatched',
      metadata: {
        agent_slug: slug,
        ...(project !== undefined ? { project } : {}),
        ...(costCeilingUsd !== undefined ? { kickoff_ceiling_usd: costCeilingUsd } : {}),
      },
    });
    // Staging happens AFTER runId is minted (it needs a run dir to write
    // into) and BEFORE spawnAgentDispatch (so the spawned agent process
    // can see the files). A `MaterialsStagingError` here is a SERVER-side
    // anomaly, not a client-attributable refusal — every client-fixable
    // problem already 400'd above, and the client cannot plant a
    // symlink/hardlink under a runId it never knew in advance — so it
    // falls through to the route's normal catch below, which maps it to a
    // 500 via the existing `sanitizeError`, not a hand-rolled sanitiser.
    if (materialsValidation.entries.length > 0) {
      const runDir = join(ctx.logsRoot, runId);
      // `runId` is server-minted (just above) and `ctx.logsRoot` is
      // config-derived — both trusted, neither built from untrusted
      // input — so realizing the run's own directory here is safe.
      // `isSafeRunId(runId)` is already enforced immediately after the id
      // is minted (see the hoisted guard above) — it used to live here,
      // but W7-B5's t0 marker now writes under `runId` before this block
      // runs, so the check had to move ahead of the FIRST write rather
      // than sit in front of the second one. Same guard-symmetry intent
      // (spawnAgentDispatch, the run-status route, this mkdir), one site
      // earlier.
      // This is the run's FIRST staged artifact: under FORGE_DRY_BRIDGE,
      // spawnAgentDispatch below never runs, so nothing else creates
      // `runDir` before `stageMaterials`/`resolveGuardedPath` need it to
      // already exist.
      mkdirSync(runDir, { recursive: true });
      stageMaterials(
        runDir,
        materialsValidation.entries.map((m) => ({ filename: m.filename, bytes: m.bytes })),
      );
      // Record REFERENCES ONLY (relative path + derived kind) on the run's
      // own event log — never the bytes (forge-wide rule: the event log
      // logs refs, never contents).
      createLogger(runId, ctx.logsRoot).emit({
        initiative_id: runId,
        phase: 'orchestrator',
        skill: slug,
        // NOT 'start' — `runAgent` (orchestrator/run-agent.ts:297) already
        // emits the run's real lifecycle `start` event when the spawned
        // process runs; a second `start` here would double up the
        // lifecycle terminal for the same runId (wrong "when did this run
        // begin" answers, an inflated events count on the status route).
        // This is a supplementary record, not a lifecycle boundary — 'log'
        // is the established shape for that (mirrors
        // 'run-agent.spawn-suppressed', also a non-lifecycle `log` event).
        event_type: 'log',
        input_refs: materialsValidation.entries.map((m) => `materials/${m.filename}`),
        output_refs: [],
        message: 'agent-run.materials-staged',
        metadata: {
          materials: materialsValidation.entries.map((m) => ({ path: `materials/${m.filename}`, kind: m.kind })),
        },
      });
    }
    // Bead forge-c6h — thread the bridge's own snapshot projects root
    // through as --projects-root so a dispatch carrying a --session-dir
    // (none on this generic route today — sessionDir is `undefined` here;
    // the flag is inert without it) never has to re-derive it downstream.
    deps.spawnAgentDispatch(ctx.forgeRoot, slug, runId, project, inputs, undefined, costCeilingUsd, deps.projectsRoot);
    // agents-20: start streaming this run's log to connected WS clients
    // now that events.jsonl exists (ensureTailFor no-ops on a missing
    // file, which is why the t0 event above must land first). The status
    // route re-arms after any WS reconnect.
    deps.ensureAgentRunTail(runId);
    sendJson(
      res,
      200,
      { ok: true, runId, slug, ...deps.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/agents/:slug/run', runId) },
      origin,
    );
  } catch (err) {
    // A MaterialsStagingError (thrown by stageMaterials) lands here too —
    // deliberately: it maps to the SAME 500 + sanitizeError() as every
    // other unexpected failure on this route, not a hand-rolled second
    // sanitiser. See the staging call above for why a staging throw is a
    // server-state anomaly rather than a client-attributable 400. Worth a
    // distinct server-side log line, though, since this specific path
    // means containment refused a write under a runId only the server
    // ever knew — an environment fault, never a client mistake.
    if (err instanceof MaterialsStagingError) {
      console.error(`POST /api/agents/:slug/run: materials staging failed: ${err.message}`);
    }
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
};
