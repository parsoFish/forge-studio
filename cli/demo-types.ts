/**
 * Shared demo-artifact schema types (ADR 021 / ADR 035 / F4).
 *
 * The `demo.json` the unifier authors is the single source of truth for a
 * cycle's demo; the review surface renders it natively and forge derives the
 * PR-facing `DEMO.md` from it. These are the structured section types that
 * `demo.json` (`DemoModel`, in demo-model.ts) and the markdown renderer share.
 *
 * (Before F4 these lived in demo-html.ts alongside a parallel DEMO.html
 * renderer. F4 retired DEMO.html — demo OUTPUT is one markdown — so the schema
 * types moved here, leaving no HTML renderer behind.)
 */

/** Per-image inline cap (bytes). Shared by the capture path (demo.ts) and the
 *  inline encoder (demo-model.ts) so demo.json can never balloon past it. */
export const MAX_INLINE_IMAGE_BYTES = 1_500_000;

/**
 * One measured metric, paired before vs after, for a `kind: 'harness'`
 * checkpoint.
 */
export type HarnessMetricRow = {
  label: string;
  unit?: string;
  before: string | null;
  after: string | null;
  /** (after-before)/|before|*100, numeric metrics only; null otherwise. */
  deltaPct: number | null;
  parity: 'match' | 'within' | 'diverged' | 'incomplete';
};

/** Build/compile status of a checked-out tree (the demo capture path runs a
 *  build at the before/after refs and records whether it succeeded). */
export type DemoBuildStatus = {
  ok: boolean;
  detail?: string;
};

// ── Rich structured sections (REV-4 / D3) ────────────────────────────────

export type DemoSummarySection = {
  bullets: string[];
  prUrl?: string;
  commitSha?: string;
  branch?: string;
};

export type DemoApiDiffEntry = {
  name: string;
  change: 'added' | 'changed' | 'removed';
  before?: string;
  after?: string;
};

export type TestResultRow = {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  delta?: string;
};
