/**
 * The verdict gate's pure view logic (forge-mfv5.1.31).
 *
 * The review artifacts arrive in shapes built for a PR body, not a page: the
 * adversarial review joins one chunk per work item into each of `summary`,
 * `why`, `what` and `how` as `[WI-1] … [WI-2] …`; criteria carry a `(WI-n)`
 * prefix; checkpoint labels name their work item (`Plan 4: WI-2`). These
 * helpers re-cut that data by work item so no field renders as one unbroken
 * paragraph. Nothing here judges the evidence — they only regroup it.
 */
import type { ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** Captured stdout carries terminal escapes (`terraform init` colours); a page shows text. */
export function stripAnsi(text: string | null | undefined): string {
  return (text ?? '').replace(ANSI, '');
}

const WI_MARKER = /\[(WI-\d+|unattributed)\]\s*/g;
const WI_NAME = /\bWI-\d+\b/;

export type WorkItemSlice = { id: string; text: string };

/** Split `[WI-n]`-joined reviewer prose into one slice per marker; text before the first marker (or with none) keeps id ''. */
export function splitByWorkItem(text: string | null | undefined): WorkItemSlice[] {
  const src = text ?? '';
  const out: WorkItemSlice[] = [];
  let id = '';
  let start = 0;
  for (const m of src.matchAll(WI_MARKER)) {
    const piece = src.slice(start, m.index).trim();
    if (piece) out.push({ id, text: piece });
    id = m[1]!;
    start = m.index! + m[0].length;
  }
  const tail = src.slice(start).trim();
  if (tail) out.push({ id, text: tail });
  return out;
}

/** The first `n` sentences of `text`, and how many were left out (the caller offers the rest). */
export function leadSentences(text: string, n: number): { sentences: string[]; omitted: number } {
  const all = text.split(/(?<=[.;!?])\s+(?=[A-Z`(\[])/).map((s) => s.trim()).filter(Boolean);
  return { sentences: all.slice(0, n), omitted: Math.max(0, all.length - n) };
}

export type AcVerdict = 'met' | 'partial' | 'missed';
export type GateCriterion = {
  /** `ac-<n>`, 1-based — the comment region id the S10 beats anchor to. */
  regionId: string;
  raw: string;
  wi: string;
  text: string;
  verdict: AcVerdict | null;
  evidence: string;
};

type Evaluation = NonNullable<ReviewFindingsDoc['acEvaluations']>[number];

/** Each criterion with the reviewer's evaluation OF THAT TEXT (never matched by position alone — a reordered review must not pin one criterion's verdict on another). */
export function joinCriteria(criteria: readonly string[], evaluations: readonly Evaluation[] = []): GateCriterion[] {
  return criteria.map((raw, i) => {
    const m = /^\((WI-\d+)\)\s*([\s\S]*)$/.exec(raw);
    const ev = evaluations.find((e) => e.criterion === raw);
    return {
      regionId: `ac-${i + 1}`,
      raw,
      wi: m?.[1] ?? '',
      text: m?.[2] ?? raw,
      verdict: ev?.verdict ?? null,
      evidence: ev?.evidence ?? '',
    };
  });
}

const SEVERITY_ORDER = ['blocker', 'major', 'minor', 'info'] as const;
type Finding = NonNullable<ReviewFindingsDoc['findings']>[number];
export type FindingGroup = { id: string; summary: string; items: Finding[] };

/** Findings grouped by their id prefix (`WI-1/RF-2` → `WI-1`) in first-seen order, severity-sorted, each with its work item's summary slice. */
export function groupFindings(doc: Pick<ReviewFindingsDoc, 'summary' | 'findings'>): FindingGroup[] {
  const slices = splitByWorkItem(doc.summary);
  const groups = new Map<string, Finding[]>();
  for (const f of doc.findings ?? []) {
    const id = (f.id ?? '').split('/')[0] ?? '';
    groups.set(id, [...(groups.get(id) ?? []), f]);
  }
  // An unknown severity sorts last, never above a blocker.
  const rank = (f: Finding): number => {
    const i = SEVERITY_ORDER.indexOf(f.severity ?? 'info');
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  return [...groups].map(([id, items]) => ({
    id,
    summary: slices.find((s) => s.id === id)?.text ?? '',
    items: [...items].sort((a, b) => rank(a) - rank(b)),
  }));
}

export type CheckpointGroup<T> = { wi: string; items: Array<{ index: number; cp: T }> };

/** Checkpoints grouped by the work item their label names, in order, each keeping its index (`checkpoint-<index+1>`). */
export function groupCheckpoints<T extends { label: string }>(cps: readonly T[]): Array<CheckpointGroup<T>> {
  const out: Array<CheckpointGroup<T>> = [];
  cps.forEach((cp, index) => {
    const wi = WI_NAME.exec(cp.label)?.[0] ?? '';
    const last = out[out.length - 1];
    if (last && last.wi === wi) last.items.push({ index, cp });
    else out.push({ wi, items: [{ index, cp }] });
  });
  return out;
}

export function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** True when the review judged a different commit than the branch head (forge-mfv5.1.30); unknown is never "stale". */
export function reviewHeadIsStale(reviewedSha: string | undefined, headSha: string | undefined): boolean {
  if (!reviewedSha || !headSha) return false;
  const n = Math.min(reviewedSha.length, headSha.length, 7);
  return reviewedSha.slice(0, n) !== headSha.slice(0, n);
}

export type SideMode = 'output' | 'frame' | 'video' | 'note';

/** Captured stdout is the readable evidence for a command checkpoint (forge-nk1y.30: frames are 320 px stills). */
export function defaultSideMode(side: { output?: string | null; image?: string | null; video?: string | null }): SideMode {
  if (side.output) return 'output';
  if (side.image) return 'frame';
  if (side.video) return 'video';
  return 'note';
}

/** `git diff --stat`'s last line, or null for any other shape. */
export function parseDiffStat(stat: string): { files: number; insertions: number; deletions: number } | null {
  const files = /(\d+) files? changed/.exec(stat);
  if (!files) return null;
  const num = (re: RegExp): number => Number(re.exec(stat)?.[1] ?? 0);
  return { files: Number(files[1]), insertions: num(/(\d+) insertions?\(\+\)/), deletions: num(/(\d+) deletions?\(-\)/) };
}
