/**
 * Verdict file shape + parser for the review human moment.
 *
 * The operator's review verdict lives in a single markdown file,
 * `<queueRoot>/in-flight/<initiativeId>.verdict-response.md`, with a stable
 * contract: YAML frontmatter (`verdict: approve | send-back` + `rationale`)
 * plus, for send-back, a list of acceptance-criterion bullets.
 *
 * The forge UI (the sole operator interaction surface) writes this file via
 * the UI bridge's `POST /api/verdict`. The send-back loop then re-enters the
 * cycle through a requeue (`resume_from: unifier`), so nothing polls or blocks
 * waiting on this file — it is the artifact, not a transport. This module owns
 * the path resolution + the parser; the bridge owns the writer.
 */

import { resolve } from 'node:path';

import type { AcceptanceCriterion } from './work-item.ts';

/**
 * Verdict shape — the operator's response to the review prompt.
 */
export type Verdict =
  | { kind: 'approve'; rationale: string }
  | { kind: 'send-back'; feedback: AcceptanceCriterion[]; rationale: string };

export type FileVerdictPaths = {
  promptPath: string;
  responsePath: string;
};

/**
 * Resolve the standard file-verdict paths for an initiative. Pure — no I/O.
 * The CLI + UI bridge use this to know where to read/write.
 */
export function fileVerdictPaths(
  initiativeId: string,
  queueRoot = '_queue',
): FileVerdictPaths {
  const inFlight = resolve(queueRoot, 'in-flight');
  return {
    promptPath: resolve(inFlight, `${initiativeId}.verdict-prompt.md`),
    responsePath: resolve(inFlight, `${initiativeId}.verdict-response.md`),
  };
}

/**
 * Parse the operator's response file into a `Verdict`. Tolerates leading
 * whitespace and CRLF line endings; rejects unknown verdict kinds.
 */
export function parseVerdictResponse(text: string): Verdict {
  const fmMatch = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error('verdict-response: missing YAML frontmatter');
  }
  const fm = parseFrontmatter(fmMatch[1]);
  const body = fmMatch[2] ?? '';

  const kind = fm.verdict?.trim();
  const rationale = (fm.rationale ?? '').trim();

  if (kind === 'approve') {
    return { kind: 'approve', rationale };
  }
  if (kind === 'send-back') {
    const feedback = parseAcceptanceCriteria(body);
    if (feedback.length === 0) {
      throw new Error(
        'verdict-response: send-back must include at least one acceptance criterion (- GIVEN ... WHEN ... THEN ...)',
      );
    }
    return { kind: 'send-back', feedback, rationale };
  }
  throw new Error(`verdict-response: unknown verdict kind: ${kind ?? '(empty)'}`);
}

/**
 * Minimal YAML frontmatter parser. Supports `key: value` and `key: |` block
 * scalars. Sufficient for the verdict-response shape; not a general parser.
 */
function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const blockMatch = line.match(/^(\w+):\s*\|\s*$/);
    if (blockMatch) {
      const key = blockMatch[1];
      i += 1;
      const blockLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.length === 0) {
          blockLines.push('');
          i += 1;
          continue;
        }
        if (/^\s/.test(l)) {
          blockLines.push(l.replace(/^\s{1,2}/, ''));
          i += 1;
          continue;
        }
        break;
      }
      out[key] = blockLines.join('\n');
      continue;
    }
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      out[kvMatch[1]] = kvMatch[2];
    }
    i += 1;
  }
  return out;
}

/**
 * Parse acceptance-criterion bullet lines from a markdown body. Tolerates
 * the `- AC:` prefix (mirroring the fix_plan.md send-back format) plus a
 * plain `- GIVEN` form. Used by `parseVerdictResponse` for send-back ACs.
 */
export function parseAcceptanceCriteria(body: string): AcceptanceCriterion[] {
  const acs: AcceptanceCriterion[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const match =
      line.match(/^-\s+AC:\s+GIVEN\s+(.+?)\s+WHEN\s+(.+?)\s+THEN\s+(.+)$/i) ??
      line.match(/^-\s+GIVEN\s+(.+?)\s+WHEN\s+(.+?)\s+THEN\s+(.+)$/i);
    if (match) {
      acs.push({
        given: match[1].trim(),
        when: match[2].trim(),
        then: match[3].trim(),
      });
    }
  }
  return acs;
}
