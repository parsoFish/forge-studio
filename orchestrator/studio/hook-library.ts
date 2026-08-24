/**
 * Hooks library — model + registry (R3-03-F1/F1b).
 *
 * A library HOOK is an agent-lifecycle customisation — `{id, name,
 * description, on (lifecycle event), matcher?, script, permissions}` — read
 * from a FILE PACKAGE at `studio/hooks/<id>/hook.yaml` (+ the script files it
 * references), deliberately parallel to a skill package. It is GENERIC and
 * HOST-AGNOSTIC: a definition never names a binding — that would let a hook
 * package fabricate its own "carried by" claim. Binding happens only in the
 * Agent Builder, via `composition.hooks` (a list of library hook ids); "carried
 * by" is DERIVED from real agent specs (`deriveHookUsage`), never declared.
 *
 * `composition.guards` (renamed from `composition.hooks` by the immediately
 * preceding PR) stays the PLATFORM dispatch-key vocabulary — the 5 toggle ids
 * plus the 5 band ids (`orchestrator/agent-bands.ts`'s `PLATFORM_GUARD_IDS`).
 * `composition.hooks` is reintroduced HERE meaning ONLY library hook ids.
 * Enforcement is SYMMETRIC (`lintHookComposition`): a guard id under
 * `composition.hooks` is an error, and a hook id under `composition.guards`
 * is an error — a one-directional check is the half-guard this repo has
 * already been bitten by (see docs/decisions/027-studio-object-model.md's
 * "Amendment (R3-03, 2026-08-04)").
 *
 * Every id-taking export below slug-validates before it ever touches a path —
 * see `orchestrator/skill-path.ts` (the guard lives there so it covers every
 * current and future caller, not just this module) — so a traversal-shaped id
 * is rejected before any read, mirroring skill-library.ts's own convention.
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { assertSkillSlug, FORGE_ROOT, listSkillMdDirs } from '../skill-path.ts';
import { PLATFORM_GUARD_IDS } from '../agent-bands.ts';
import { isStudioAgent, loadAgentDefinition } from './registry.ts';
import { reqString, optString, optBool, stringArray, oneOf, loadYaml } from './yaml-fields.ts';
import type { AgentDefinition } from './types.ts';
import type { Finding } from './validate.ts';

// ---------------------------------------------------------------------------
// F1 — the closed lifecycle-event registry (mirrors flow-trigger.ts's
// TRIGGER_KINDS pattern: a fixed, exhaustive vocabulary checked at load time).
// ---------------------------------------------------------------------------

export const HOOK_LIFECYCLE_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'Notification',
  'UserPromptSubmit',
] as const;
export type HookLifecycleEvent = (typeof HOOK_LIFECYCLE_EVENTS)[number];

/**
 * The lifecycle events whose SDK hook input carries a `tool_name` — the only
 * ones a declared `matcher` can be evaluated against. `SessionStart`,
 * `SessionEnd`, `Notification` and `UserPromptSubmit` inputs have no tool at
 * all, so a matcher on one of them can never be honoured.
 *
 * DERIVED FROM DISPATCH, not a second opinion about it: `hook-dispatch.ts`'s
 * `hookMatcherMatches` returns false the moment `input.tool_name` is not a
 * string, which is exactly this set. Kept next to the event registry so the
 * lint and the dispatch cannot drift apart — this repo's standing lesson is
 * that defense-in-depth lint must mirror the dispatch it backstops.
 */
export const TOOL_SCOPED_HOOK_EVENTS = ['PreToolUse', 'PostToolUse'] as const;

// ---------------------------------------------------------------------------
// Matcher parsing — forge's own `Tool` / `Tool(commandPrefix)` syntax.
//
// Lives HERE, next to the definition it validates, rather than in
// hook-dispatch.ts where it started: `hookTriggerError` below is the shape
// check on all five write paths and it must reuse dispatch's own parse rather
// than retype the regex (this repo's standing lesson — a defense-in-depth
// check that reimplements the thing it backstops drifts from it). The other
// direction, hook-library importing hook-dispatch, would be an import cycle
// that drags the whole dispatch graph — registry, derive, hook-runtime — into
// every lint and bridge route that reads a hook definition.
//
// hook-dispatch.ts keeps the ENFORCEMENT (`hookMatcherMatches`); only the
// parse moved.
// ---------------------------------------------------------------------------

export type ParsedHookMatcher = { tool: string; commandPrefix?: string };

/**
 * Three outcomes, not two.
 *
 * W8-B6 FIX-2 (2026-08-24 hostile review): this used to return
 * `ParsedHookMatcher | undefined`, where `undefined` meant "no matcher ⇒ fires
 * on every occurrence of the event". A string that did not match the
 * `Tool(args)` regex — `Bash(gh pr create`, one missing paren — fell through
 * to `{tool: <the whole raw string>}`, which `hookMatcherMatches` then
 * compared against a real `tool_name`. No tool is called
 * `"Bash(gh pr create"`, so the hook was permanently inert, and the no-match
 * branch logged nothing at all.
 *
 * `malformed` cannot collapse into `absent`: absent means "fire always", so
 * folding a typo into it would hand a broken guard a veto over EVERY tool
 * call — strictly worse than the silence it replaces. It is its own state,
 * refused by the write paths and never fired by dispatch.
 */
export type HookMatcherParse =
  | { kind: 'absent' }
  | { kind: 'matcher'; matcher: ParsedHookMatcher }
  | { kind: 'malformed'; reason: string };

/** A bare tool name: no parens, no whitespace. `Bash`, `Read`,
 *  `mcp__server__tool` — the shape an SDK `tool_name` can actually take. */
const MATCHER_BARE_TOOL = /^[^()\s]+$/;
const MATCHER_WITH_ARGS = /^([^()\s]+)\((.*)\)$/;

/** Parse a declared `matcher`. Absent/blank ⇒ `{kind:'absent'}` ⇒ matches
 *  every occurrence of the event. Exported for the lint + the five write
 *  paths that mirror this dispatch (via `hookTriggerError`). */
export function parseHookMatcher(raw: string | undefined): HookMatcherParse {
  const trimmed = raw?.trim();
  if (!trimmed) return { kind: 'absent' };
  const withArgs = MATCHER_WITH_ARGS.exec(trimmed);
  if (withArgs) return { kind: 'matcher', matcher: { tool: withArgs[1]!, commandPrefix: withArgs[2]!.trim() } };
  if (MATCHER_BARE_TOOL.test(trimmed)) return { kind: 'matcher', matcher: { tool: trimmed } };
  return {
    kind: 'malformed',
    reason:
      'is neither a bare tool name nor Tool(commandPrefix) — dispatch compares a matcher against a real tool name, ' +
      'and this string can never equal one, so the hook would be authored, approved, displayed as carried, and never fire',
  };
}

/**
 * The trigger-coherence rule, as a pure predicate so it has ONE implementation
 * and five callers (`lintHookDefinitions` below, the hook create and update
 * bridge routes, the authoring-session finalize route, and the community
 * install route). Returns an operator-facing message, or `undefined` when the
 * trigger is coherent.
 *
 * It checks TWO independent things, in order:
 *
 *  1. SHAPE (W8-B6 FIX-2) — the matcher must parse into something dispatch can
 *     evaluate. Reuses `parseHookMatcher` above rather than retyping its
 *     regex: one source of truth, so the backstop cannot drift from the
 *     dispatch it backstops.
 *  2. EVENT COHERENCE — a matcher needs a `tool_name` to match against, and
 *     only `TOOL_SCOPED_HOOK_EVENTS` carry one.
 *
 * Shape first, because a malformed matcher is wrong on every event, including
 * the two the coherence rule would otherwise wave through.
 *
 * A blank/whitespace matcher counts as none — that is literally what the
 * authoring form submits for an empty field — and stays legal.
 */
export function hookTriggerError(on: HookLifecycleEvent, matcher: string | undefined): string | undefined {
  const parse = parseHookMatcher(matcher);
  if (parse.kind === 'absent') return undefined;
  if (parse.kind === 'malformed') {
    return (
      `matcher ${JSON.stringify(matcher)} ${parse.reason}. ` +
      `Write it as a tool name (e.g. "Bash") or as Tool(commandPrefix) (e.g. "Bash(gh pr create)").`
    );
  }
  if ((TOOL_SCOPED_HOOK_EVENTS as readonly string[]).includes(on)) return undefined;
  return (
    `matcher ${JSON.stringify(matcher)} is declared on "${on}", which carries no tool — a matcher can only be ` +
    `honoured on ${TOOL_SCOPED_HOOK_EVENTS.join(' or ')}. Dispatch would never fire this hook. ` +
    `Remove the matcher, or move the hook to a tool-scoped event.`
  );
}

/**
 * A `hook.yaml` declaring any of these top-level keys is REJECTED — a
 * definition never names a binding (round-4 mockup rule). This makes
 * "definitions land unbound" structural, not conventional: no amount of
 * hand-editing a hook package can make it claim its own carried-by agent.
 */
export const FORBIDDEN_HOOK_BINDING_KEYS: readonly string[] = ['agent', 'agents', 'boundTo', 'carriedBy', 'bind', 'composition'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HookPermissionManifest {
  /** Env var names this hook may read (deny-by-default: absent ⇒ none). */
  env: string[];
  /** Path prefixes this hook may read (deny-by-default: absent ⇒ none). */
  read: string[];
  /** Whether this hook may perform network egress (deny-by-default: absent ⇒ false). */
  network: boolean;
}

export interface HookDefinition {
  id: string;
  name: string;
  description: string;
  on: HookLifecycleEvent;
  matcher?: string;
  /** Relative to the hook's own directory — validated to resolve inside it. */
  script: string;
  permissions: HookPermissionManifest;
}

/** Names the real on-disk source a `carriedBy` array was scanned from, and how
 *  many of that source were scanned — the anti-fabrication device: an empty
 *  `carriedBy` always reads as "scanned N, found none", never "unknown".
 *  Mirrors template-library.ts's `TemplateUsedByDerivation`. */
export interface HookUsedByDerivation {
  readonly source: string;
  readonly scanned: number;
}

/**
 * `ok` discriminates a successfully-loaded hook from a malformed one
 * (2026-08-04 peer-review finding) — a malformed entry must carry NO
 * fabricated field values. `HookDefinition`'s fields stay REQUIRED on this
 * type (not split into a narrower `ok:true`-only interface) because the
 * common case every real caller indexes — a well-formed library entry — must
 * read them without a narrowing dance; `listHookLibrary`'s own OOTB-seed
 * tests do exactly that (`entries.find(...).on`, no `if (entry.ok)` guard).
 * The fabrication guarantee is instead a RUNTIME one, enforced in
 * `listHookLibrary`'s malformed branch below: that object literal genuinely
 * has no `on`/`script`/`permissions`/`name`/`description` key at all — never
 * a placeholder value alongside `error` (the exact shape an earlier round's
 * `on: 'PreToolUse'` placeholder took, which adversarial review caught) — a
 * consumer must check `ok` before trusting those fields present, exactly as
 * this module's own tests verify via `'on' in entry` etc.
 */
export interface HookLibraryEntry extends HookDefinition {
  ok: boolean;
  /** DERIVED from real agent specs' composition.hooks — never declared (D3 precedent). */
  carriedBy: string[];
  carriedByDerivation: HookUsedByDerivation;
  /** Set only on the `ok:false` branch — a well-formed entry carries no `error` key at all. */
  error?: string;
}

const HOOK_USAGE_SOURCE = 'skills/*/SKILL.md (composition.hooks)';

// ---------------------------------------------------------------------------
// Path helpers — slug-validate before ever constructing a path.
// ---------------------------------------------------------------------------

export function hooksDir(root: string = FORGE_ROOT): string {
  return join(root, 'studio', 'hooks');
}

export function hookDir(id: string, root: string = FORGE_ROOT): string {
  assertSkillSlug(id, 'hook');
  return join(hooksDir(root), id);
}

export function hookYamlPath(id: string, root: string = FORGE_ROOT): string {
  assertSkillSlug(id, 'hook');
  return join(hooksDir(root), id, 'hook.yaml');
}

/** Every hook id with a `studio/hooks/<id>/hook.yaml` package on disk, sorted.
 *  Absent/unreadable dir ⇒ []. Listing tolerates a directory whose NAME is not
 *  itself slug-shaped (existence-only, mirrors listSkillDirs) — slug
 *  validation happens at LOOKUP time (hookDir/loadHookDefinition), not here. */
export function listHookIds(root: string = FORGE_ROOT): string[] {
  const dir = hooksDir(root);
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names.filter((name) => existsSync(join(dir, name, 'hook.yaml'))).sort();
}

// ---------------------------------------------------------------------------
// Script-path boundary check — traversal (`../`, encoded, absolute, symlink
// escape) is rejected BEFORE any read of the script itself. Mirrors the
// boundary-check pattern in skill-library.ts's walkPackageDir /
// installSkillPackage (realpath + startsWith(boundary + sep)).
// ---------------------------------------------------------------------------

function resolveHookScriptPath(hookDirPath: string, scriptRel: string): string {
  if (isAbsolute(scriptRel)) {
    throw new Error(`hook script path must be relative to the hook directory, got an absolute path "${scriptRel}"`);
  }
  const boundary = resolve(hookDirPath) + sep;

  // URL-encoded traversal probe (e.g. "%2e%2e/outside.sh"): decode defensively
  // and check the DECODED form too, not just the literal text — a naive
  // resolve() on the still-encoded string would never see the "..".
  let decoded = scriptRel;
  try {
    decoded = decodeURIComponent(scriptRel);
  } catch {
    /* malformed percent-escape ⇒ leave as literal text, the raw check below still applies */
  }

  const resolvedLiteral = resolve(hookDirPath, scriptRel);
  const resolvedDecoded = resolve(hookDirPath, decoded);
  if (!resolvedLiteral.startsWith(boundary) || !resolvedDecoded.startsWith(boundary)) {
    throw new Error(`hook script path "${scriptRel}" escapes the hook directory "${hookDirPath}"`);
  }

  // Symlink escape: can only be checked once the entry exists on disk.
  if (existsSync(resolvedLiteral)) {
    const real = realpathSync(resolvedLiteral);
    const rootReal = resolve(hookDirPath);
    if (real !== rootReal && !real.startsWith(boundary)) {
      throw new Error(
        `hook script path "${scriptRel}" resolves (after following symlinks) outside the hook directory "${hookDirPath}"`,
      );
    }
  }

  return resolvedLiteral;
}

function parseHookPermissions(raw: unknown, file: string): HookPermissionManifest {
  const obj = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    env: stringArray(obj, 'env', file),
    read: stringArray(obj, 'read', file),
    network: optBool(obj, 'network') ?? false,
  };
}

// ---------------------------------------------------------------------------
// loadHookDefinition — F1 model + registry. THROWS (never returns a
// partial/invalid model) on: bad slug, `on` outside the closed set, script
// escaping the hook dir, or a forbidden binding key.
// ---------------------------------------------------------------------------

export function loadHookDefinition(id: string, root: string = FORGE_ROOT): HookDefinition {
  const dir = hookDir(id, root); // throws on a bad slug before any path is touched
  const yamlPath = hookYamlPath(id, root);
  const d = loadYaml(yamlPath);

  for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
    if (key in d) {
      throw new Error(
        `${yamlPath}: hook.yaml must not declare a binding field "${key}:" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder (composition.hooks)`,
      );
    }
  }

  const name = reqString(d, 'name', yamlPath);
  const description = reqString(d, 'description', yamlPath);
  const on = oneOf(reqString(d, 'on', yamlPath), HOOK_LIFECYCLE_EVENTS, yamlPath, 'on');
  const matcher = optString(d, 'matcher');
  const scriptRel = reqString(d, 'script', yamlPath);
  resolveHookScriptPath(dir, scriptRel); // throws before any read of the script
  const permissions = parseHookPermissions(d['permissions'], yamlPath);

  return { id, name, description, on, matcher, script: scriptRel, permissions };
}

// ---------------------------------------------------------------------------
// deriveHookUsage / listHookLibrary — carriedBy is DERIVED from real agent
// specs, never declared. Takes a ROOT (template-library.ts's
// deriveArtifactTemplateUsage precedent), not an AgentDefinition[] array.
// ---------------------------------------------------------------------------

/** Studio agents, tolerating a malformed one — a single bad sibling must not
 *  crash the whole scan (mirrors skill-library.ts's own resilient listing). */
function listAgentDefinitionsResilient(root: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  for (const dir of listSkillMdDirs(join(root, 'skills'))) {
    const mdPath = join(dir, 'SKILL.md');
    if (!isStudioAgent(mdPath)) continue;
    try {
      defs.push(loadAgentDefinition(mdPath));
    } catch {
      /* malformed studio agent — already reported elsewhere; skip here */
    }
  }
  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
}

function computeHookUsage(forgeRoot: string): { byHook: Map<string, string[]>; derivation: HookUsedByDerivation } {
  const agents = listAgentDefinitionsResilient(forgeRoot);
  const byHook = new Map<string, Set<string>>();
  for (const agent of agents) {
    for (const hookId of new Set(agent.composition.hooks)) {
      if (!byHook.has(hookId)) byHook.set(hookId, new Set());
      byHook.get(hookId)!.add(agent.slug);
    }
  }
  const out = new Map<string, string[]>();
  for (const [hookId, slugs] of byHook) out.set(hookId, [...slugs].sort((a, b) => a.localeCompare(b)));
  return { byHook: out, derivation: { source: HOOK_USAGE_SOURCE, scanned: agents.length } };
}

export function deriveHookUsage(forgeRoot: string): Map<string, string[]> {
  return computeHookUsage(forgeRoot).byHook;
}

export function listHookLibrary(forgeRoot: string): HookLibraryEntry[] {
  const { byHook, derivation } = computeHookUsage(forgeRoot);
  const entries: HookLibraryEntry[] = [];
  for (const id of listHookIds(forgeRoot)) {
    const carriedBy = byHook.get(id) ?? [];
    try {
      const def = loadHookDefinition(id, forgeRoot);
      entries.push({ ...def, ok: true, carriedBy, carriedByDerivation: derivation });
    } catch (e) {
      // Genuinely NO on/script/permissions/name/description key at runtime —
      // never a placeholder alongside `error`. HookLibraryEntry declares
      // those fields required (so the well-formed common case needs no
      // narrowing to read them — see the type's own doc comment); this is
      // the one place that gap is deliberately spanned, for a value that
      // structurally omits them, not one that invents them.
      const malformed: Pick<HookLibraryEntry, 'ok' | 'id' | 'carriedBy' | 'carriedByDerivation' | 'error'> = {
        ok: false,
        id,
        carriedBy,
        carriedByDerivation: derivation,
        error: (e as Error).message,
      };
      entries.push(malformed as HookLibraryEntry);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// lintHookDefinitions — turns a per-id load failure into a Finding (the
// roadmap's literal "on: outside the closed event set is a lint ERROR").
// ---------------------------------------------------------------------------

export function lintHookDefinitions(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  for (const id of listHookIds(forgeRoot)) {
    try {
      const def = loadHookDefinition(id, forgeRoot);
      // W8-B6 — mirror hook dispatch's matcher rule (see hookTriggerError).
      const triggerError = hookTriggerError(def.on, def.matcher);
      if (triggerError) {
        findings.push({
          level: 'error',
          object: `hook:${id}`,
          check: 'hook-library/trigger',
          message: triggerError,
        });
      }
    } catch (e) {
      findings.push({
        level: 'error',
        object: `hook:${id}`,
        check: 'hook-library/load',
        message: (e as Error).message,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// checkHookComposition — the SYMMETRIC guards/hooks-split rule, factored to a
// PURE predicate over one agent's composition (2026-08-04, third appearance
// of the same defect class: a rule implemented, unit-tested, and inert
// because production never invokes it — see cli/bridge-studio-writes-hook-
// unknown.test.ts's header). `lintHookComposition` below scans ON-DISK
// agents; the bridge PUT route (cli/bridge-studio-writes.ts) needs the SAME
// rule applied to the IN-MEMORY candidate composition it is about to write,
// which is NOT yet on disk — re-scanning disk there would silently miss the
// very save it's supposed to gate. One shared rule, two callers, rather than
// a second copy that could drift from this one.
// ---------------------------------------------------------------------------

export function checkHookComposition(
  agentSlug: string,
  composition: { hooks: readonly string[]; guards: readonly string[] },
  guardIds: ReadonlySet<string>,
  hookIds: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const obj = `agent:${agentSlug}`;

  for (const hookRef of composition.hooks) {
    if (guardIds.has(hookRef)) {
      findings.push({
        level: 'error',
        object: obj,
        check: 'hook-library/guard-in-hooks',
        message: `Agent "${agentSlug}" composes platform guard id "${hookRef}" under composition.hooks — guard ids belong under composition.guards (ADR-027 R3-03 amendment)`,
      });
    } else if (!hookIds.has(hookRef)) {
      findings.push({
        level: 'error',
        object: obj,
        check: 'hook-library/unknown-hook-ref',
        message: `Agent "${agentSlug}" composes hook id "${hookRef}" under composition.hooks which resolves to neither a platform guard nor a real library hook (studio/hooks/${hookRef}/)`,
      });
    }
  }

  for (const guardRef of composition.guards) {
    if (!guardIds.has(guardRef) && hookIds.has(guardRef)) {
      findings.push({
        level: 'error',
        object: obj,
        check: 'hook-library/hook-in-guards',
        message: `Agent "${agentSlug}" composes library hook id "${guardRef}" under composition.guards — library hook ids belong under composition.hooks (ADR-027 R3-03 amendment)`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// lintHookComposition — SYMMETRIC enforcement of the guards/hooks split,
// scanned across every ON-DISK agent. Sourced from PLATFORM_GUARD_IDS (a
// fixed platform-vocabulary constant), not studio/catalog.yaml —
// catalog.yaml is a display surface over these ids, not their source of
// truth, and a lint fixture root may not seed one at all.
// ---------------------------------------------------------------------------

export function lintHookComposition(forgeRoot: string): Finding[] {
  const guardIds = new Set<string>(PLATFORM_GUARD_IDS);
  const hookIds = new Set(listHookIds(forgeRoot));
  const agents = listAgentDefinitionsResilient(forgeRoot);

  const findings: Finding[] = [];
  for (const agent of agents) {
    findings.push(...checkHookComposition(agent.slug, agent.composition, guardIds, hookIds));
  }
  return findings;
}
