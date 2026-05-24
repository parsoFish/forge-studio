/**
 * `forge send-back <init> --feedback <file>` — operator-side send-back
 * for a ready-for-review cycle.
 *
 * MVP behaviour: write the verdict-response.md to the right place per
 * the file-verdict.ts protocol. The next time the scheduler picks up
 * the manifest (or the operator runs the cycle again), the reviewer
 * sees the send-back and feeds the feedback to the unifier in send-
 * back mode (per CONTRACTS.md C3b).
 *
 * Where the file lands:
 *   - in-flight/         → if a cycle is actively polling (rare; the
 *                          file-verdict provider is what polls)
 *   - ready-for-review/  → for post-cycle send-back (the common case)
 *
 * Either way the file shape is the same — `parseVerdictResponse` is
 * tolerant of either location's reads.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPaths } from '../orchestrator/queue.ts';
import { resolveInitiativeId } from '../orchestrator/initiative-id.ts';
import { parseAcceptanceCriteria } from '../orchestrator/file-verdict.ts';

export type SendBackOptions = {
  /** Forge root (parent of _queue/). Defaults to cwd. */
  forgeRoot?: string;
};

export type SendBackResult = {
  initiativeId: string;
  queueDir: 'in-flight' | 'ready-for-review';
  verdictPath: string;
  acCount: number;
};

export function runSendBack(
  initInput: string,
  feedbackPath: string,
  opts: SendBackOptions = {},
): SendBackResult {
  const forgeRoot = opts.forgeRoot ?? process.cwd();
  const queuePaths = getPaths(join(forgeRoot, '_queue'));

  const resolved = resolveInitiativeId(initInput, { queueRoot: queuePaths.root });
  if (resolved.kind !== 'ok') {
    throw new Error(`no initiative resolves "${initInput}" (${resolved.kind}).`);
  }
  const initiativeId = resolved.canonical;
  const filename = `${initiativeId}.md`;

  // Where is the manifest? Prefer in-flight (a poll loop may be live);
  // otherwise ready-for-review.
  let queueDir: 'in-flight' | 'ready-for-review';
  let manifestDir: string;
  if (existsSync(join(queuePaths.inFlight, filename))) {
    queueDir = 'in-flight';
    manifestDir = queuePaths.inFlight;
  } else if (existsSync(join(queuePaths.readyForReview, filename))) {
    queueDir = 'ready-for-review';
    manifestDir = queuePaths.readyForReview;
  } else {
    throw new Error(`no in-flight or ready-for-review manifest ${filename} found.`);
  }

  // Read the feedback file. Must contain ≥1 GIVEN/WHEN/THEN AC.
  if (!existsSync(feedbackPath)) {
    throw new Error(`feedback file not found: ${feedbackPath}`);
  }
  const feedbackBody = readFileSync(feedbackPath, 'utf8');
  const acs = parseAcceptanceCriteria(feedbackBody);
  if (acs.length === 0) {
    throw new Error(
      `feedback file ${feedbackPath} contains no acceptance criteria. Expected format:\n  - GIVEN <precondition> WHEN <action> THEN <expected>`,
    );
  }

  // The send-back rationale: prefer the first markdown header line, else
  // a generic one. (The feedback file body itself isn't transcribed —
  // the agent reads it via fix_plan.md in the unifier re-run.)
  const rationaleMatch = feedbackBody.match(/^#\s+(.+)$/m);
  const rationale = rationaleMatch
    ? rationaleMatch[1].trim()
    : 'See acceptance criteria below.';

  const verdictBody = renderSendBackVerdict(rationale, acs);
  const verdictPath = join(manifestDir, `${initiativeId}.verdict-response.md`);

  // Atomic tmp+rename (per file-verdict.ts C16 atomic-write contract).
  const tmpPath = verdictPath + '.tmp';
  writeFileSync(tmpPath, verdictBody);
  renameSync(tmpPath, verdictPath);

  return { initiativeId, queueDir, verdictPath, acCount: acs.length };
}

function renderSendBackVerdict(
  rationale: string,
  acs: Array<{ given: string; when: string; then: string }>,
): string {
  const fmRationale = rationale.split('\n').map((l) => '  ' + l).join('\n');
  const body = acs
    .map((a) => `- GIVEN ${a.given.trim()} WHEN ${a.when.trim()} THEN ${a.then.trim()}`)
    .join('\n');
  return `---\nverdict: send-back\nrationale: |\n${fmRationale}\n---\n\n## Acceptance criteria\n\n${body}\n`;
}
