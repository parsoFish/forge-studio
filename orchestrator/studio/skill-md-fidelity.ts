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

import type { AgentDefinition } from './types.ts';

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

const COMPOSITION_ARRAY_KEYS = ['skills', 'tools', 'mcps', 'guards', 'hooks'] as const;

/**
 * D5 fast-path support: `composition`'s five vocabulary arrays all default to
 * `[]` on load when absent (`stringArray` in yaml-fields.ts) — a real
 * `SKILL.md` written before the `hooks:` field existed omits that key
 * entirely, exactly like `skills: []` written out explicitly. Normalize the
 * ORIGINAL parsed data the same way the loader itself already does before
 * comparing it against the freshly projected data, so an omitted key never
 * masquerades as a substantive frontmatter difference — this mirrors the
 * loader's own default, it does not invent new leniency (no other field
 * needs this: fanout/materials/library/phase/surface/executor are already
 * conditionally-omitted on both sides, and budgets sub-keys have no
 * non-omitted default).
 */
function normalizeOriginalDataForComparison(originalData: unknown): unknown {
  if (originalData === null || typeof originalData !== 'object' || Array.isArray(originalData)) {
    return originalData;
  }
  const d = originalData as Record<string, unknown>;
  const rawComposition = d['composition'];
  if (rawComposition === null || typeof rawComposition !== 'object' || Array.isArray(rawComposition)) {
    return d;
  }
  const comp = rawComposition as Record<string, unknown>;
  const normalizedComposition: Record<string, unknown> = { ...comp };
  for (const key of COMPOSITION_ARRAY_KEYS) {
    if (!(key in normalizedComposition)) normalizedComposition[key] = [];
  }
  return { ...d, composition: normalizedComposition };
}

/**
 * D2 fast-path fix (registry.test.ts "materials vs byte-fidelity (R2-09
 * defect)"): D2 declares an absent `materials:` key and a declared-empty
 * `materials: []` semantically IDENTICAL — both mean "accepts nothing", by
 * design, with no "undeclared ⇒ allow all" reading anywhere. The real UI
 * save path (forge-ui/app/agents/[id]/page.tsx) always sends
 * `materials: state.materials`, defaulting to `[]`, so saving any of the 16
 * roster agents that has never declared materials makes the freshly
 * projected data disagree with the on-disk parse under a plain deep-equal,
 * defeating the byte-faithful fast path and destroying comments/key order —
 * exactly the bug this normalizes away. Canonicalize "materials key absent"
 * to an explicit `[]` on BOTH sides before the comparison, so [] and absent
 * compare equal; a genuinely non-empty array on either side is left alone
 * and still forces the full re-serialize (do not "simplify" this into
 * ignoring materials in the comparison — that would silently drop a real
 * declaration or a real deselection-to-empty, see the round-4 tests pinning
 * both directions).
 */
function normalizeMaterialsForComparison(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const d = value as Record<string, unknown>;
  if ('materials' in d) return d;
  return { ...d, materials: [] };
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
    const comparableFresh = normalizeMaterialsForComparison(data);
    const comparableOriginal = normalizeMaterialsForComparison(normalizeOriginalDataForComparison(originalData));
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
