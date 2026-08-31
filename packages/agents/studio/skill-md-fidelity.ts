/**
 * Byte-fidelity serialization for Agent SKILL.md files (ADR-027, D5/D6 —
 * R2-09). Extracted from `registry.ts` (2026-08-05, finding C/11) to keep
 * that file under its 800-line hard cap — a pure import-home move, zero
 * behaviour change, matching the precedent already set by `yaml-fields.ts` /
 * `kb-descriptor.ts` / `materials.ts`. `serializeAgentDefinition` remains the
 * ONE canonical serializer (ADR-027); `registry.ts` re-exports it so every
 * existing importer keeps resolving it from `'./registry.ts'` — this module
 * is an implementation detail, not a new public seam.
 */

import matter from 'gray-matter';

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

/**
 * Build the frontmatter `data` record for an AgentDefinition (ADR-027 fixed
 * key order: name, description, library?, phase?, surface?, executor?,
 * purpose, composition, runtime, fanout?, materials?, brainAccess,
 * interactivity, allowed-tools, disallowed-tools, budgets). Pure — the same
 * projection backs both the full re-serialize path and the D5 byte-fidelity
 * comparison in serializeAgentDefinition.
 */
function projectAgentFrontmatter(def: AgentDefinition): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  data['name'] = def.name;
  data['description'] = def.description;
  if (def.library !== undefined) data['library'] = def.library;
  if (def.phase !== undefined) data['phase'] = def.phase;
  if (def.surface !== undefined) data['surface'] = def.surface;
  if (def.executor !== undefined) data['executor'] = def.executor;
  data['purpose'] = def.purpose;
  data['composition'] = def.composition;

  const runtime: Record<string, unknown> = {
    sdk: def.runtime.sdk,
    strategy: def.runtime.strategy,
  };
  if (def.runtime.model !== undefined) runtime['model'] = def.runtime.model;
  if (def.runtime.range !== undefined) runtime['range'] = def.runtime.range;
  if (def.runtime.loopStrategy !== undefined) runtime['loopStrategy'] = def.runtime.loopStrategy;
  data['runtime'] = runtime;

  // R2-03-F2 — fanout block (only when declared; omit undefined sub-keys).
  if (def.fanout !== undefined) {
    const fanout: Record<string, unknown> = {
      drivingArtifact: def.fanout.drivingArtifact,
      isolation: def.fanout.isolation,
    };
    if (def.fanout.concurrencyCap !== undefined) fanout['concurrencyCap'] = def.fanout.concurrencyCap;
    if (def.fanout.perItemGate !== undefined) fanout['perItemGate'] = def.fanout.perItemGate;
    data['fanout'] = fanout;
  }

  // R2-09 D2 — emitted only when DECLARED (undefined omitted entirely, like
  // fanout above); a declared-empty [] is still meaningful and IS emitted
  // (registry.test.ts "declared-empty materials must still be emitted").
  if (def.materials !== undefined) data['materials'] = def.materials;

  data['brainAccess'] = def.brainAccess;
  data['interactivity'] = def.interactivity;
  data['allowed-tools'] = def.allowedTools;
  data['disallowed-tools'] = def.disallowedTools;

  // Omit budgets keys that are undefined
  const budgets: Record<string, unknown> = {};
  if (def.budgets.iterationFloor !== undefined) budgets['iterationFloor'] = def.budgets.iterationFloor;
  if (def.budgets.iterationCap !== undefined) budgets['iterationCap'] = def.budgets.iterationCap;
  if (def.budgets.maxTurnsPerIteration !== undefined)
    budgets['maxTurnsPerIteration'] = def.budgets.maxTurnsPerIteration;
  if (def.budgets.wedgeKillMs !== undefined) budgets['wedgeKillMs'] = def.budgets.wedgeKillMs;
  if (def.budgets.maxTurns !== undefined) budgets['maxTurns'] = def.budgets.maxTurns;
  if (def.budgets.maxBudgetUsd !== undefined) budgets['maxBudgetUsd'] = def.budgets.maxBudgetUsd;
  if (def.budgets.maxBudgetUsdShare !== undefined)
    budgets['maxBudgetUsdShare'] = def.budgets.maxBudgetUsdShare;
  data['budgets'] = budgets;

  return data;
}

/**
 * Order-independent (object keys) / order-sensitive (arrays) structural
 * equality over plain JSON-like values. A small local compare (D5) — no YAML
 * library, no node:assert try/catch-as-boolean trick — used only to decide
 * whether serializeAgentDefinition can take the byte-preserving fast path.
 */
function deepValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepValueEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as Record<string, unknown>).sort();
    const bk = Object.keys(b as Record<string, unknown>).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepValueEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * D5/D2 general fast-path normalization rule (R2-09) — ONE mechanism, not a
 * growing per-field list. The defect class: several optional fields are
 * ARRAY-valued and the loader (or the bridge merge, sourced from the UI's
 * always-concrete default) treats an absent key and a declared-`[]` key as
 * the same state — "nothing declared". The freshly projected frontmatter
 * always carries the loader/merge's own default shape, but the ORIGINAL
 * file on disk may predate the field, or a hand-authored/legacy file may
 * omit it entirely; a plain deep-equal then sees `key: []` on one side and no
 * `key` at all on the other and (wrongly) treats that as a substantive
 * frontmatter change, defeating the byte-faithful fast path and destroying
 * comments/key order for a save that changed NOTHING semantically.
 *
 * For the purpose of THIS COMPARISON ONLY (never for what gets WRITTEN —
 * `projectAgentFrontmatter` above is untouched and still emits/omits each key
 * by its own rule): backfill every path in OPTIONAL_ARRAY_PATHS to an
 * explicit `[]` when the key is absent, applied identically to BOTH the
 * freshly projected data and the original parsed data, so an absent key and a
 * declared-empty array always compare equal. A genuinely NON-empty array on
 * either side is left untouched by this and still forces the full
 * re-serialize — this is "absent ≡ empty", never "ignore this field" (see the
 * per-field real-change / reverse-asymmetry tests in registry.test.ts pinning
 * both directions for every path below).
 *
 * D2 (registry.test.ts "materials vs byte-fidelity") is the `materials`
 * instance of this class — the real UI save path
 * (apps/studio/app/agents/[id]/page.tsx) always sends `materials: state.materials`
 * defaulting to `[]`, so saving any of the 16 roster agents that has never
 * declared materials hit exactly this. `composition.*`'s five vocabulary
 * arrays are the same shape (a real `SKILL.md` written before `hooks:`
 * existed omits that key, exactly like `tools: []` written out explicitly —
 * `stringArray` in yaml-fields.ts is the loader default this mirrors).
 * `runtime.range` (LIVE — every roster agent declares `strategy: fixed` with
 * no `range:` key, while the builder always sends `runtime.range: []`) and
 * `allowed-tools`/`disallowed-tools` (latent — `stringArray` defaults both
 * unconditionally) are the same class again. A future optional array field
 * just adds its path here — do not add another bespoke normalizer function.
 */
const OPTIONAL_ARRAY_PATHS: readonly (readonly string[])[] = [
  ['composition', 'skills'],
  ['composition', 'tools'],
  ['composition', 'mcps'],
  ['composition', 'guards'],
  ['composition', 'hooks'],
  ['materials'],
  ['runtime', 'range'],
  ['allowed-tools'],
  ['disallowed-tools'],
];

function backfillAbsentArrayAtPath(
  container: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  const [key, ...rest] = path;
  if (key === undefined) return container;
  if (rest.length === 0) {
    return key in container ? container : { ...container, [key]: [] };
  }
  const nested = container[key];
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
    // The parent container (e.g. `composition`, `runtime`) is itself absent
    // or not a plain object — there is nothing to backfill INTO, so leave
    // the outer object as-is. (A file that omits `composition:`/`runtime:`
    // entirely is a bigger structural difference than one missing array key
    // and is correctly left to force the full re-serialize, same as before
    // this rule existed.)
    return container;
  }
  return { ...container, [key]: backfillAbsentArrayAtPath(nested as Record<string, unknown>, rest) };
}

function normalizeAbsentOptionalArrays(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return OPTIONAL_ARRAY_PATHS.reduce(
    (acc, path) => backfillAbsentArrayAtPath(acc, path),
    value as Record<string, unknown>,
  );
}

/**
 * Serialize an AgentDefinition back to SKILL.md text (ADR-027; consumed by
 * the M2 bridge PUT routes, no production call site until then).
 *
 * D5/D6 (R2-09): when `originalRaw` is supplied and the freshly projected
 * frontmatter data deep-equals the original file's parsed frontmatter data,
 * the original frontmatter block is kept byte-for-byte (delimiters, `#`
 * comments, key order, whitespace) and only the body region is replaced —
 * `def.body` is appended VERBATIM, no leading-newline normalization.
 * Otherwise (no `originalRaw`, or the frontmatter actually changed) this
 * falls back to the full re-serialize below — today's behaviour, minus the
 * `^-{3,}` → en-dash body mutation (D6, deleted: it corrupted real bodies —
 * a ```yaml fenced example and a mid-body thematic break — because the whole
 * SKILL.md, en-dashes included, is read verbatim into agent system prompts).
 */
export function serializeAgentDefinition(def: AgentDefinition, originalRaw?: string): string {
  const data = projectAgentFrontmatter(def);

  if (originalRaw !== undefined) {
    const { data: originalData, content: originalContent } = matter(originalRaw);
    const comparableFresh = normalizeAbsentOptionalArrays(data);
    const comparableOriginal = normalizeAbsentOptionalArrays(originalData);
    if (deepValueEqual(comparableFresh, comparableOriginal)) {
      const bodyStart = originalRaw.length - originalContent.length;
      return originalRaw.slice(0, bodyStart) + def.body;
    }
  }

  // Pass a `{content}` file object (not a bare string) so gray-matter's
  // internal `matter.stringify` re-parse step never runs on `def.body` itself.
  // `matter.stringify` starts with `if (typeof file === 'string') file =
  // matter(file, options)` — handing it a BARE STRING body re-parses that
  // string for ITS OWN frontmatter, which is a genuine injection vector: a
  // body whose first line is a literal `---` (e.g. `---\nevil: INJECTED\n---`)
  // would be misread as its own frontmatter delimiter, leaking `evil` into
  // the written frontmatter block and truncating the visible body (D6 proof,
  // registry.test.ts). The `{content: def.body}` object form is what skips
  // that internal re-parse branch entirely — it is LOAD-BEARING, not
  // incidental style. Do not "simplify" this back to a bare
  // `matter.stringify(def.body, data)` call; that reintroduces the
  // vulnerability this comment exists to prevent.
  return matter.stringify({ content: def.body }, data);
}
