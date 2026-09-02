/**
 * The id vocabulary and the ONE slug guard — every studio object id in the
 * product passes through this module before it reaches a path join.
 *
 * MOVED VERBATIM from `packages/agents/skill-path.ts` (M4-library PR 2, T1
 * ruling on park #1 Q3). It lives in kernel rather than in library because
 * `orchestrator/studio/validate.ts` re-exports `SLUG_RE`, `EXACT_ID_RE`,
 * `PROJECT_ID_RE`, `KB_ID_RE`, `MAX_EXACT_ID_LENGTH`, `RESERVED_OBJECT_IDS`
 * and `isReservedId` to validate PROJECTS and KNOWLEDGE BASES — objects the
 * library package does not own. Kernel is "the facts every other package
 * needs and none of them owns"; this is one of them. Every consumer
 * (contracts aside) can reach rank 1, which no package rank 2 could offer.
 *
 * A true leaf: `node:path` only, no fs, no cycle. That property is load-
 * bearing and predates this move — the definitions were pulled out of
 * `validate.ts` in the first place to break a
 * `skill-path → validate → registry → skill-path` cycle that survived only
 * because every cyclic import happened inside a function body.
 */
import { resolve } from 'node:path';

/**
 * The slug shape shared across every studio object id (agents, flows,
 * artifacts, KBs, skills, ...). Defined HERE — this module is a true leaf
 * (only `node:fs`/`node:path`) — and re-exported from
 * `orchestrator/studio/validate.ts` for its 20+ existing call sites.
 *
 * This definition used to live in `validate.ts` and be imported back into
 * this file, closing a `skill-path → validate → registry → skill-path`
 * cycle (registry.ts imports this module; validate.ts imports registry.ts).
 * It worked only because every cyclic import was consumed inside function
 * bodies, never at module top level — one future eager top-level call would
 * have reintroduced a TDZ crash for whichever module became the process
 * entry. Moving the definition to this leaf module removes the cycle
 * entirely rather than relying on that fragile invariant.
 */
export const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * W7-A4 — the ONE id rule for projects and knowledge bases: the id IS the
 * on-disk directory name, case-preserving, matched exactly (see
 * `orchestrator/studio/validate.ts` for the full contract + the reserved-id
 * and reason helpers). Defined in this leaf for the same cycle reason as
 * SLUG_RE; `PROJECT_ID_RE`/`KB_ID_RE` are named aliases of one predicate so
 * a project and the KB bound to it can never disagree about legality.
 */
export const EXACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const PROJECT_ID_RE = EXACT_ID_RE;
export const KB_ID_RE = EXACT_ID_RE;
/** Length cap shared by every project/KB id validator (one path segment). */
export const MAX_EXACT_ID_LENGTH = 128;

/**
 * M4 §4 (projects routes carve, T1 ruling) — the charset guard for run/gate/
 * session-style ids (`runId`, `gateId`, `sessionId`, …): alphanumeric plus
 * `_`/`-`, no `/`, `.`, `..`, whitespace or null bytes. HOISTED VERBATIM from
 * `cli/bridge-studio.ts` ("Safe-ID guard: blocks path traversal in run/gate
 * IDs"), which re-exports this binding rather than defining it, so its many
 * existing importers (`cli/ui-bridge.ts`, `packages/flows/bridge-studio-runs.ts`,
 * `packages/sessions/bridge-studio-sessions.ts`) are unaffected.
 *
 * Same source pattern as `EXACT_ID_RE` above (both are
 * `/^[A-Za-z0-9][A-Za-z0-9_-]*$/`) but a DIFFERENT concept — `EXACT_ID_RE`
 * names a project/KB's on-disk directory identity, `SAFE_ID_RE` is a generic
 * traversal-safety charset for opaque ids (run/gate/session) that carry no
 * directory-identity meaning of their own. Kept as two named bindings rather
 * than merged: a carve is not the place to fold two concepts that happen to
 * share a regex source into one.
 */
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Ids the UI reserves as static route segments (`/projects/new`, `/agents/new`,
 * `/flows/new`, `/skills/new`, `/hooks/new`, `/knowledge/new`). An object
 * literally named `new` would be permanently shadowed by the builder that lives
 * at that path (W7-A4, projects-30 / crosscut-20), so every create route refuses
 * it — case-insensitively, since slugs are lowercased at creation and a
 * case-preserving KB id `New` would still sit next to the static segment.
 */
export const RESERVED_OBJECT_IDS: ReadonlySet<string> = new Set(['new']);

export function isReservedId(id: string): boolean {
  return RESERVED_OBJECT_IDS.has(id.toLowerCase());
}

/** Hard cap on a skill id's length. Without this, a charset-valid but
 *  absurdly long id sails past the regex guard and dies later as a raw
 *  `ENAMETOOLONG` from `mkdir`/`writeFileSync` — an opaque OS error instead
 *  of an actionable validation message naming the actual limit. */
export const MAX_SKILL_ID_LENGTH = 100;

/** The slug rule as PLAIN PROSE + the bare pattern source (no leading `/`):
 *  `sanitizeError` (cli/bridge-studio.ts) redacts every `/…` token from
 *  bridge error strings, and a RegExp literal's own `/^…$/` was being eaten
 *  into `[path]:-[a-z0-9]+)*$/` on the wire (walkthrough library-13). */
export const SLUG_RULE_TEXT = `a single lowercase-kebab path segment matching ${SLUG_RE.source} (lowercase letters, digits and hyphens); no "/", "\\", ".", or ".."`;

/** Reject any `name` that is not a bare slug component — no `/`, `\`, `.`,
 *  `..`, or empty string can ever reach a path join past this point — and no
 *  id longer than `MAX_SKILL_ID_LENGTH` characters. `noun` names the object
 *  kind in the message (skill / hook / connection / community item) — the
 *  same rule guards every file-package id, so the caller supplies the word
 *  the operator will read (library-13: a hooks route used to say "invalid
 *  skill id"). Additive-optional (ADR 042: disclose-not-park). */
export function assertSkillSlug(name: string, noun: string = 'skill'): void {
  if (name.length > MAX_SKILL_ID_LENGTH) {
    throw new Error(
      `invalid ${noun} id "${name.slice(0, 40)}…" — ${name.length} characters exceeds the ${MAX_SKILL_ID_LENGTH}-character length limit for a ${noun} id`,
    );
  }
  if (!SLUG_RE.test(name)) {
    throw new Error(
      `invalid ${noun} id "${name}" — must be ${SLUG_RULE_TEXT}`,
    );
  }
}

/**
 * The forge repo root — the parent of `packages/`.
 *
 * DEPTH-DEPENDENT BY CONSTRUCTION, and re-depthed on the move (T1 park #1
 * constraint a): the expression is `resolve(import.meta.dirname, '..', '..')`
 * and this file sits at `packages/kernel/`, the same depth its previous home
 * `packages/agents/` sat at — so the resolved value is unchanged. Kernel's
 * `config.ts` was checked first and has NO forge-root resolver (it takes
 * `forgeRoot` as a parameter everywhere), so there was nothing to consume and
 * no second anchor is introduced.
 *
 * This is NOT ADR 045's `resolveRoot`, which `packages/kernel/index.ts`
 * records as deliberately absent pending that ADR's own M4 roadmap items.
 * This is the quarried constant, moved with its callers; the two must not be
 * conflated, and `ids.test.ts` positive-controls the resolved value against
 * `package.json` + `skills/` so a future re-depth fails loudly instead of
 * reading an empty tree.
 */
export const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
