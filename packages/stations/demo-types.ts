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

/**
 * The on-disk basename for a checkpoint's artifact.
 *
 * bead forge-8vfn.17 (the G1 gate failure, 2026-09-04). Checkpoint labels come
 * from the initiative's `demo.json`, which an agent authors, and they used to be
 * interpolated straight into a path. A label containing `/` crashed the capture
 * with ENOENT — the parent directory does not exist — and, in a directory tree
 * where it did, would have written the artifact OUTSIDE the capture directory.
 *
 * A SAFE LABEL IS RETURNED UNCHANGED, deliberately: every `demo.json` already on
 * disk pairs its checkpoints with these filenames, and renaming them would break
 * bundles this fix is not supposed to touch. Only a label that needs slugging is
 * slugged — and then it carries a short digest of the ORIGINAL, so two labels
 * that slug to the same stem keep distinct artifacts instead of one silently
 * overwriting the other's evidence.
 */
const MAX_STEM = 120;

export function checkpointArtifactStem(label: string): string {
  // A safe label carries no separator, so the ONLY traversal-capable values left
  // are the literal `.` and `..`. An earlier draft of this function also tested
  // `label.split('.').includes('..')`; that can never be true (a dotted safe
  // string splits into empty strings, never into `..`) and is exactly the
  // decorative guard an adversarial pass is meant to find, so it is gone.
  //
  // MAX_STEM caps the safe branch too. Without it a 300-character label returned
  // unchanged and the write failed with ENAMETOOLONG — the same class as the
  // defect this function was written for, reached through a different errno.
  // A capped label is slugged, which appends a digest, so it still cannot
  // collide; `mergeCapturedMedia` pairs by stem, so the bundle still pairs.
  const SAFE = /^[A-Za-z0-9._-]+$/;
  const isSafe = SAFE.test(label) && label !== '.' && label !== '..' && label.length <= MAX_STEM;
  if (isSafe) return label;
  const stem = label
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_STEM);
  // A digest of the original, so `a/b` and `a-b` never name the same file.
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (Math.imul(31, h) + label.charCodeAt(i)) | 0;
  const digest = (h >>> 0).toString(36).slice(0, 6);
  return `${stem || 'checkpoint'}-${digest}`;
}

/** `checkpointArtifactStem` plus the extension — what actually lands on disk. */
export function checkpointArtifactName(label: string, ext: string): string {
  return `${checkpointArtifactStem(label)}.${ext}`;
}
