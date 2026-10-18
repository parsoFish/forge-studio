/**
 * A review chunk whose agent reached its turn or budget cap — forge-mfv5.1.61.
 *
 * gitweave I4 round 4: seventeen chunks passed, then one work item's chunk and
 * then its first file on its own (85 lines) ended `error_max_turns`. The
 * pipeline failed the cycle with "too large for review": no findings artifact,
 * no verdict gate, seventeen paid-for records and ten unreviewed files thrown
 * away. Nothing had measured the file; the agent had spent its turns elsewhere.
 *
 * A capped chunk is now PARTIAL, never a failed review. Its record is the
 * agent's own file when it wrote a valid one before the cap, else one `major`
 * finding the orchestrator authors, naming the files nobody finished judging.
 * Either way the chunk is named in `partialChunks` with what it spent, so the
 * verdict gate shows it and the operator weighs it — the cap is never hidden.
 */

import type { PartialChunk, ReviewFindingsRecord } from '@forge/flows';

/** The SDK subtypes that mean "the cap stopped it" — `error_max_turns`, `error_max_budget_usd`. */
export function isCapExhaustion(resultSubtype: string | undefined): resultSubtype is string {
  return resultSubtype !== undefined && resultSubtype.startsWith('error_max_');
}

/** What was spent, in words: turns and the last tools, never a size the pipeline did not measure. */
export function capDetail(label: string, spawn: { resultSubtype: string; toolUseCount?: number; lastTools?: string[] }): string {
  const tools = spawn.lastTools ?? [];
  return `${label}: the review agent reached its cap (${spawn.resultSubtype}) after ${spawn.toolUseCount ?? 0} tool call(s)` +
    (tools.length > 0 ? `; last: ${tools.join(' · ')}` : '') +
    '. Its chunk is reviewed partially; weigh it at the verdict gate.';
}

export function partialChunk(
  label: string,
  chunk: { workItemId: string | null; files: readonly string[] },
  spawn: { resultSubtype: string; toolUseCount?: number; lastTools?: string[] },
  source: PartialChunk['source'],
): PartialChunk {
  return {
    chunk: label,
    workItemId: chunk.workItemId,
    files: [...chunk.files],
    resultSubtype: spawn.resultSubtype,
    toolUses: spawn.toolUseCount ?? 0,
    lastTools: [...(spawn.lastTools ?? [])],
    source,
  };
}

/**
 * The orchestrator's record for a capped chunk that left no valid file: one
 * `major` finding naming every file, and every criterion `partial` — nobody
 * finished judging it, so it is neither met nor missed.
 */
export function unreviewedRecord(args: {
  identity: Pick<ReviewFindingsRecord, 'initiative_id' | 'cycleId' | 'baseRef' | 'headSha'>;
  files: readonly string[];
  criteria: readonly string[];
  lenses: readonly string[];
  detail: string;
}): ReviewFindingsRecord {
  const notJudged = 'not judged: the review agent reached its cap before authoring a verdict (verdict authored by the orchestrator, not by a review agent)';
  const files = args.files.length > 0 ? args.files : ['(empty diff)'];
  return {
    ...args.identity,
    reviewedAt: new Date().toISOString(),
    summary: `Unreviewed: ${args.detail}`,
    lenses: [...args.lenses],
    findings: [{
      id: 'RF-unreviewed',
      severity: 'major',
      category: args.lenses[0]!,
      title: `unreviewed: turn cap — ${files.length} file(s) not reviewed`,
      detail: args.detail,
      evidence: files.map((file) => ({ file })),
    }],
    acEvaluations: args.criteria.map((criterion) => ({ criterion, verdict: 'partial' as const, evidence: notJudged })),
    whyWhatHow: { why: notJudged, what: notJudged, how: notJudged },
  };
}
