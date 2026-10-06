/**
 * Manifest construction for the architect kind — `buildManifest`, `slugify`
 * and the flow id they stamp.
 *
 * Split out of `kinds/architect.ts` (M4 exit row 5, ruling 96), and it is the
 * reason that split is three-way rather than two. `runDraftStep` builds a
 * manifest and `runFinalizeStep` calls `runDraftStep`; any seam drawn between
 * draft and finalize cuts a cycle rather than a dependency. This module is the
 * leaf both of them stand on, so the cycle dissolves instead of moving.
 *
 * It depends on `architect-session.ts` alone.
 */

import type { InitiativeManifest } from '@forge/contracts';
import { type ArchitectStatus, type DraftInitiative } from './architect-session.ts';


// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

/** The seed flow an architect handoff runs under (S8/DEC-3 — architect → pm
 *  decompose). The develop build is enqueued separately onto forge-develop. */
const ARCHITECT_FLOW_ID = 'forge-architect';

export function buildManifest(
  d: DraftInitiative,
  status: ArchitectStatus,
  datePart: string,
  created_at: string,
  knownSlugs?: Set<string>,
  /** Initiative ids already present in the queue (any state). Bead forge-8vfn.30.5. */
  takenIds: ReadonlySet<string> = new Set(),
): InitiativeManifest {
  // W7-C3 deref guard — same rationale as the knownSlugs site above.
  const slug = slugify(d.slug || d.title || '');
  // Resolve cross-initiative `depends_on` slug refs → full initiative_ids.
  // Drop self-refs and refs to slugs not in this draft (would block forever).
  const dependsOnInitiatives = Array.from(
    new Set(
      (d.depends_on ?? [])
        .map((s) => slugify(s))
        .filter((dep) => dep && dep !== slug && (knownSlugs ? knownSlugs.has(dep) : true))
        .map((dep) => mintUniqueInitiativeId(datePart, dep, takenIds)),
    ),
  );
  // W7-FIX-A4 (W7A4-01): the human title the architect skill emits IS the
  // manifest's frontmatter `title:` — `initiativeTitle()` (manifest.ts) is
  // the ONE display derivation and this is its producer; without it every
  // architect-originated initiative rendered as its raw INIT id. A blank
  // draft title is absent (never `title: "  "`); the fallback chain applies.
  // `DraftInitiative` is the shape the skill is ASKED for, not one the runner
  // enforces (`runStructured` casts raw model output), so a missing/non-string
  // title degrades to the fallback chain rather than throwing out of drafting.
  const title = (typeof d.title === 'string' ? d.title : '').trim();
  // D-34 — these two DO NOT degrade the way `title` does, and the contrast
  // is the point. A missing title costs a nicer label; a missing class or a
  // malformed criterion costs the gates the work is judged by and the verdict
  // review can return, so `runStructured`'s unchecked cast is refused here
  // rather than absorbed. The message names the initiative and what arrived.
  const changeClass = requireChangeClass(d, slug);
  const acceptance_criteria = requireDraftAcceptanceCriteria(d, slug);
  return {
    initiative_id: mintUniqueInitiativeId(datePart, slug, takenIds),
    ...(title ? { title } : {}),
    project: status.project,
    project_repo_path: status.project_repo_path,
    created_at,
    iteration_budget: d.iteration_budget > 0 ? Math.round(d.iteration_budget) : 5,
    cost_budget_usd: d.cost_budget_usd > 0 ? d.cost_budget_usd : 5,
    phase: 'pending',
    origin: 'architect',
    // S8/DEC-3: route the architect's handoff to the forge-architect flow
    // (architect → pm decompose). forge-cycle was retired, so a manifest with no
    // flow_id would now throw in runCycle. After the operator approves the PLAN
    // and presses start-development, enqueue-develop-run repoints this to
    // forge-develop for the build (DEC-2 keeps the threaded cycle_id).
    flow_id: ARCHITECT_FLOW_ID,
    class: changeClass,
    acceptance_criteria,
    body: d.body,
    ...(dependsOnInitiatives.length > 0 ? { depends_on_initiatives: dependsOnInitiatives } : {}),
  };
}

const DRAFT_CHANGE_CLASSES = ['code', 'docs', 'config', 'infra'] as const;

/** D-34 — the draft's class, or a loud refusal naming what the model sent. */
function requireChangeClass(d: DraftInitiative, slug: string): InitiativeManifest['class'] {
  const raw = (d as { class?: unknown }).class;
  if (typeof raw === 'string' && (DRAFT_CHANGE_CLASSES as readonly string[]).includes(raw)) {
    return raw as InitiativeManifest['class'];
  }
  throw new Error(
    `architect draft "${slug}": class must be one of ${DRAFT_CHANGE_CLASSES.join(' | ')}, got ${JSON.stringify(raw)}`,
  );
}

/**
 * SPEC §3 — the draft's typed criteria, or a loud refusal naming the ENTRY that
 * failed. An empty list is refused too: an architect-authored initiative that
 * states no criteria has nothing for review to return a verdict on, which is
 * the silent-absence failure this field exists to end.
 */
function requireDraftAcceptanceCriteria(
  d: DraftInitiative,
  slug: string,
): InitiativeManifest['acceptance_criteria'] {
  const raw = (d as { acceptance_criteria?: unknown }).acceptance_criteria;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`architect draft "${slug}": acceptance_criteria must be a non-empty list of {given, when, then}`);
  }
  return raw.map((entry, i) => {
    const e = entry as Record<string, unknown> | null;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      throw new Error(`architect draft "${slug}": acceptance_criteria[${i}] must be an object with given/when/then`);
    }
    // `when` may be EMPTY and `given`/`then` may not. A criterion is allowed to
    // be a state assertion with no trigger — real architect output carries them
    // (a Given+Then pair, rendered with an em-dash for the absent clause) — but
    // a criterion with no precondition or no expectation asserts nothing.
    if (typeof e['when'] !== 'string') {
      throw new Error(`architect draft "${slug}": acceptance_criteria[${i}].when must be a string (it may be empty)`);
    }
    for (const key of ['given', 'then'] as const) {
      const v = e[key];
      if (typeof v !== 'string' || v.trim().length === 0) {
        throw new Error(`architect draft "${slug}": acceptance_criteria[${i}].${key} must be a non-empty string`);
      }
    }
    return { given: String(e['given']), when: String(e['when']), then: String(e['then']) };
  });
}

/**
 * Row 129 (bead forge-8vfn.8.1.56) — the ONE place `INIT-<date>-` gets
 * prepended onto a slug, so the two call sites above cannot drift apart on
 * how they guard against doubling it. The architect's own slug can already
 * carry a date, or the literal `INIT-` token, or both: real runs minted
 * `INIT-2026-09-26-2026-09-26-exclude-author-flag` (S10 run 34) and
 * `INIT-2026-09-27-2026-09-28-exclude-author-filter` (run 41 — the two dates
 * DIFFER, the slug carried the PREVIOUS day's date). Stripping any such
 * prefix off the slug before applying the mint date keeps an ordinary slug
 * untouched and makes a re-mint of an already-prefixed one idempotent.
 */
export function mintInitiativeId(datePart: string, slug: string): string {
  return `INIT-${datePart}-${stripLeadingIdPrefixes(slug)}`;
}

/**
 * Bead forge-8vfn.30.5 — `mintInitiativeId`, but never an id already in the
 * queue: `-2`, `-3` … is appended until free. An id minted twice lets a stale
 * `_queue/done/` manifest of the same id masquerade as the new run's outcome.
 * Pure and deterministic in `taken`, so a sibling's `depends_on` ref and the
 * sibling's own manifest resolve to the SAME id. Uniquifying rather than
 * refusing keeps an unattended architect run alive.
 */
export function mintUniqueInitiativeId(datePart: string, slug: string, taken: ReadonlySet<string>): string {
  const base = mintInitiativeId(datePart, slug);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const LEADING_INIT_TOKEN = /^init-/i;
const LEADING_DATE_SEGMENT = /^\d{4}-\d{2}-\d{2}(-|$)/;

function stripLeadingIdPrefixes(slug: string): string {
  let s = slug.replace(LEADING_INIT_TOKEN, '');
  while (LEADING_DATE_SEGMENT.test(s)) {
    s = s.replace(LEADING_DATE_SEGMENT, '');
  }
  if (s === '') {
    throw new Error(`architect draft slug "${slug}" is only an id prefix — no initiative name is left to mint`);
  }
  return s;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'initiative'
  );
}
