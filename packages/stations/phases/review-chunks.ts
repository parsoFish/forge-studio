/**
 * How the reviewer's diff is cut into bounded pieces — bead forge-8vfn.6.10.24.
 *
 * G2 died at the review beat (`error_max_turns`, no findings artifact, no
 * verdict gate, no merge): one spawn read the whole initiative's diff, so its
 * work scaled with the change while its budget did not.
 *
 * The chunk is the WORK ITEM, and that introduces NO NEW NUMBER — a byte or file
 * threshold would be a constant invented from one data point, the mistake the
 * flat `DERIVED_CEILING_MARGIN_USD` made one bead ago. The PM already bounded
 * the work item, one agent authored it, its gate already ran over it.
 *
 * **That last sentence was measured false** (bead `forge-8vfn.6.10.26`). G2's
 * resume logged `chunk=WI-1` passing and `chunk=WI-2` exhausting on eight files:
 * a work item the developer built at `iters=1` still exceeded the reviewer's 50
 * turns, because the PM's bound is DEVELOPER-shaped and the reviewer's load is
 * DIFF-shaped. So the work item is the FIRST cut; the second is the file, which
 * is still not a number anybody invented.
 *
 * Files no work item claims become one final `unattributed` chunk, so nothing
 * escapes review. A SINGLE FILE that still exhausts fails LOUDLY naming the file
 * (ruling 290 as amended by 311) — never skipped, never given more budget.
 */

import type { ReviewFindingsRecord } from '@forge/flows/flow-artifacts.ts';

/** The subset of a work item this partition needs. */
export type ChunkableWorkItem = {
  readonly work_item_id: string;
  readonly files_in_scope: readonly string[];
  readonly creates?: readonly string[];
};

export type ReviewChunk = {
  /** The work item this chunk reviews, or `null` for the unattributed remainder. */
  readonly workItemId: string | null;
  /** Changed files this chunk owns. Never empty — an empty chunk is not produced. */
  readonly files: readonly string[];
};

/** The label a chunk carries in events, prompts and failure messages. */
export const UNATTRIBUTED_CHUNK_ID = 'unattributed';

export function chunkLabel(chunk: ReviewChunk): string {
  return chunk.workItemId ?? UNATTRIBUTED_CHUNK_ID;
}

/**
 * Partition `changedFiles` across `workItems`, in work-item order, then the
 * remainder. A file claimed twice goes to the FIRST claimant, so the union of
 * the chunks is the diff and no hunk is judged twice. A work item claiming
 * nothing here produces no chunk — no question to ask, no spawn to pay for.
 */
export function partitionChangedFiles(
  changedFiles: readonly string[],
  workItems: readonly ChunkableWorkItem[],
): ReviewChunk[] {
  const unassigned = new Set(changedFiles);
  const chunks: ReviewChunk[] = [];
  for (const wi of workItems) {
    const claimed: string[] = [];
    for (const path of [...(wi.creates ?? []), ...wi.files_in_scope]) {
      if (unassigned.has(path)) {
        unassigned.delete(path);
        claimed.push(path);
      }
    }
    if (claimed.length > 0) chunks.push({ workItemId: wi.work_item_id, files: claimed });
  }
  // Order-stable remainder: the diff's own order, not the Set's.
  const rest = changedFiles.filter((f) => unassigned.has(f));
  if (rest.length > 0) chunks.push({ workItemId: null, files: rest });
  return chunks;
}

/**
 * Merge the per-chunk records into the ONE artifact the verdict gate reads.
 *
 * Chunking is an implementation of how the review is BOUGHT, not a second
 * output format: `review-findings.json` keeps its shape, and a reader who never
 * heard of chunks sees one review of one head SHA.
 *
 * `unjudgedCriteria` carries the acceptance criteria of work items that
 * produced no chunk — their declared files are absent from the diff, so no
 * agent was ever shown them. They are judged here, deterministically `missed`:
 * a work item that delivered no file cannot have met a criterion, and that is a
 * verdict the orchestrator reaches without a model. Leaving them out would make
 * the merged record fail its own coverage check; leaving them unjudged would be
 * the vacuous gate one door over.
 */
export function mergeChunkRecords(
  chunks: ReadonlyArray<{ label: string; record: ReviewFindingsRecord }>,
  unjudgedCriteria: ReadonlyArray<{ criterion: string; workItemId: string }>,
): ReviewFindingsRecord {
  const first = chunks[0]?.record;
  if (first === undefined) {
    throw new Error('mergeChunkRecords: no chunk records — a review with nothing to merge is a caller error, never an empty pass');
  }
  const label = (s: string, text: string): string => `[${s}] ${text}`;
  return {
    initiative_id: first.initiative_id,
    cycleId: first.cycleId,
    baseRef: first.baseRef,
    headSha: first.headSha,
    reviewedAt: first.reviewedAt,
    summary: chunks.map((c) => label(c.label, c.record.summary)).join('\n'),
    lenses: first.lenses,
    // Ids are namespaced by their chunk: two chunks may independently author an
    // `F1`, and a merged list with two `F1`s is a list whose findings cannot be
    // referred to. The prefix doubles as provenance — which work item a finding
    // is about, without a new field.
    findings: chunks.flatMap((c) => c.record.findings.map((f) => ({ ...f, id: `${c.label}/${f.id}` }))),
    acEvaluations: [
      ...chunks.flatMap((c) => c.record.acEvaluations),
      ...unjudgedCriteria.map(({ criterion, workItemId }) => ({
        criterion,
        verdict: 'missed' as const,
        evidence: `no file declared by ${workItemId} appears in this diff — the work item delivered nothing, so its criterion cannot be met (verdict authored by the orchestrator, not by a review agent)`,
      })),
    ],
    whyWhatHow: {
      why: chunks.map((c) => label(c.label, c.record.whyWhatHow.why)).join('\n'),
      what: chunks.map((c) => label(c.label, c.record.whyWhatHow.what)).join('\n'),
      how: chunks.map((c) => label(c.label, c.record.whyWhatHow.how)).join('\n'),
    },
  };
}

/**
 * One chunk per FILE, all of them still owned by the same work item.
 *
 * Reached only when a work-item chunk's spawn was killed for turns/budget. The
 * file is the smallest unit the diff already carries, so this invents no
 * threshold — the same reason the chunk is the work item in the first place.
 * The work item keeps ownership because it owns the CRITERIA: a per-file spawn
 * is shown the work item's acceptance criteria and a narrower slice of evidence,
 * never a criterion nobody declared.
 */
export function splitChunkPerFile(chunk: ReviewChunk): ReviewChunk[] {
  return chunk.files.map((file) => ({ workItemId: chunk.workItemId, files: [file] }));
}

/** `met` beats `partial` beats `missed` — the order the resolution below uses. */
const AC_VERDICT_RANK: Record<string, number> = { met: 2, partial: 1, missed: 0 };

/**
 * Merge the per-file records of ONE split work item back into a single chunk
 * record, resolving the acceptance criteria the split necessarily duplicated.
 *
 * Every per-file spawn is shown the work item's WHOLE criteria set (the contract
 * demands exact set membership), so N files produce N verdicts per criterion
 * from N narrower views. The resolution is the STRONGEST, the only rule that
 * does not manufacture a failure out of the narrowing: a criterion whose
 * evidence lives in file 3 is genuinely `missed` from file 1, and reporting that
 * would fail the initiative for the shape of the split. The winning file is
 * named and the resolution is declared the orchestrator's — an unattributed
 * merge of disagreeing verdicts is the produced-value-nobody-owns class.
 */
export function mergeSplitRecords(
  subs: ReadonlyArray<{ label: string; record: ReviewFindingsRecord }>,
): ReviewFindingsRecord {
  const merged = mergeChunkRecords(subs, []);
  const best = new Map<string, { label: string; verdict: string; evidence: string }>();
  for (const { label, record } of subs) {
    for (const e of record.acEvaluations) {
      const prior = best.get(e.criterion);
      if (prior === undefined || (AC_VERDICT_RANK[e.verdict] ?? -1) > (AC_VERDICT_RANK[prior.verdict] ?? -1)) {
        best.set(e.criterion, { label, verdict: e.verdict, evidence: e.evidence });
      }
    }
  }
  return {
    ...merged,
    acEvaluations: [...best.entries()].map(([criterion, b]) => ({
      criterion,
      verdict: b.verdict as ReviewFindingsRecord['acEvaluations'][number]['verdict'],
      evidence:
        `[${b.label}] ${b.evidence} ` +
        `(strongest of ${subs.length} per-file verdicts; resolution authored by the orchestrator, not by a review agent)`,
    })),
  };
}
