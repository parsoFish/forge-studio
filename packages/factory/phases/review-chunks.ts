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
 * Files no work item claims become one final `unattributed` chunk, so nothing
 * escapes review. A chunk that still exhausts the declared budget fails LOUDLY
 * naming its work item (ruling 290) — never skipped, never given more budget.
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
