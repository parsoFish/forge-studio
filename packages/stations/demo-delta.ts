/**
 * Delta honesty (forge-mfv5.1.7 / forge-1rk5.3): whether a checkpoint's
 * before/after evidence actually differs, and — for a command checkpoint —
 * what changed after normalising away capture noise that is not real
 * behaviour (a TAP `duration_ms`, a bare `Nms`/`N s` timing, an ISO-8601
 * timestamp).
 *
 * Split out of demo-model.ts to respect the repo's 800-line file-size cap
 * (`scripts/check-file-size.mjs`) — the same reasoning
 * `check-raw-fs-guarded.interproc.mjs`/`.destructure.mjs` use for their host
 * file: a cohesive addition that would push a baselined-at-the-cap file over
 * goes in its own module, not squeezed into the one already there.
 * `demo-model.ts` re-exports everything here so it stays the single import
 * surface for demo.json's schema and helpers.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { checkpointArtifactStem } from './demo-types.ts';
import type { DemoModel, DemoModelCheckpoint } from './demo-model.ts';
import { normaliseJsonBody } from './demo-json-delta.ts';

/** Cap on a checkpoint's `deltaExcerpt`: the PR reader needs the first
 *  differing lines, not a second copy of the whole captured output. */
export const MAX_DELTA_EXCERPT_CHARS = 1200;

/**
 * The SINGLE named list of patterns that are volatile capture noise, never
 * real before/after behaviour — a test-runner duration, a plain `Nms`/`N s`
 * timing, or an ISO-8601 timestamp differ on every run of an otherwise
 * byte-identical command. This is the one place these patterns are spelled:
 * `normaliseCapturedOutput` applies them in order, and the derived
 * essence/PR sentence (`deriveDeltaSummary`) names them by `name` rather
 * than retyping what they match, so the two can never drift apart. Frozen —
 * nothing else may mutate or re-derive this list.
 */
export const CAPTURE_NORMALISATION_RULES: ReadonlyArray<{
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}> = Object.freeze([
  { name: 'tap-duration', pattern: /duration_ms:?\s+\d+(?:\.\d+)?/g, replacement: 'duration_ms: <n>' }, // per-test `duration_ms: N` and the run summary `# duration_ms N` (row 144)
  { name: 'duration', pattern: /\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, replacement: '<duration>' },
  {
    name: 'iso-timestamp',
    pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g,
    replacement: '<timestamp>',
  },
]);

/**
 * Apply every `CAPTURE_NORMALISATION_RULES` rule, in order, to captured
 * command output before it is compared. Pure — a rule that does not match
 * leaves its input untouched.
 */
export function normaliseCapturedOutput(text: string): string {
  return CAPTURE_NORMALISATION_RULES.reduce((acc, rule) => acc.replace(rule.pattern, rule.replacement), text);
}

/**
 * A bounded `- before` / `+ after` excerpt of the first NORMALISED lines that
 * differ between two texts, capped to `MAX_DELTA_EXCERPT_CHARS` — enough for
 * a PR reader to see exactly what changed without a second copy of the whole
 * captured output.
 */
function deltaExcerptOf(beforeText: string, afterText: string): string {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const lineCount = Math.max(beforeLines.length, afterLines.length);
  const diffLines: string[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) continue;
    if (b !== undefined) diffLines.push(`- ${b}`);
    if (a !== undefined) diffLines.push(`+ ${a}`);
  }
  const joined = diffLines.join('\n');
  return joined.length > MAX_DELTA_EXCERPT_CHARS
    ? `${joined.slice(0, MAX_DELTA_EXCERPT_CHARS)}\n…[truncated]`
    : joined;
}

type CheckpointDeltaResult = {
  delta: NonNullable<DemoModelCheckpoint['delta']>;
  deltaExcerpt?: string;
};

/**
 * Delta honesty (forge-mfv5.1.7, normalisation forge-1rk5.3): a command
 * checkpoint compares its `.out` files after `normaliseCapturedOutput` (never
 * raw bytes — a TAP `duration_ms`, a bare `Nms`/`N s`, or an ISO timestamp
 * must not read as changed behaviour); a browser checkpoint (no `command`)
 * still compares the sha256 of the `.filmstrip.png`s UNTOUCHED. Either side
 * missing/unreadable ⇒ `unknown` — FAILS CLOSED, never read as `unchanged`.
 * A `changed` command checkpoint also carries a bounded `deltaExcerpt` of the
 * first normalised lines that actually differ.
 */
function checkpointDelta(cp: DemoModelCheckpoint, bundleDir: string): CheckpointDeltaResult {
  const stem = checkpointArtifactStem(cp.label);
  const textual = cp.command !== undefined || cp.apiPath !== undefined;
  const [beforeFile, afterFile] = textual
    ? [join(bundleDir, 'before', `${stem}.out`), join(bundleDir, 'after', `${stem}.out`)]
    : [join(bundleDir, 'before', `${stem}.filmstrip.png`), join(bundleDir, 'after', `${stem}.filmstrip.png`)];
  let before: Buffer;
  let after: Buffer;
  try {
    before = readFileSync(beforeFile);
    after = readFileSync(afterFile);
  } catch {
    return { delta: 'unknown' };
  }
  if (textual) {
    // An api checkpoint whose sides both parse is compared as JSON; a side that
    // is not JSON (an endpoint that did not exist before) falls to text.
    const ignore = cp.ignoreKeys ?? [];
    const [beforeJson, afterJson] = cp.form === 'api-before-after'
      ? [normaliseJsonBody(before.toString('utf8'), ignore), normaliseJsonBody(after.toString('utf8'), ignore)]
      : [null, null];
    const json = beforeJson !== null && afterJson !== null;
    const beforeText = json ? beforeJson : normaliseCapturedOutput(before.toString('utf8'));
    const afterText = json ? afterJson : normaliseCapturedOutput(after.toString('utf8'));
    if (beforeText === afterText) return { delta: 'unchanged' };
    return { delta: 'changed', deltaExcerpt: deltaExcerptOf(beforeText, afterText) };
  }
  const beforeDigest = createHash('sha256').update(before).digest('hex');
  const afterDigest = createHash('sha256').update(after).digest('hex');
  return { delta: beforeDigest === afterDigest ? 'unchanged' : 'changed' };
}

/** Annotate every checkpoint in `model` with its computed `delta` (and, for a
 *  changed command checkpoint, its `deltaExcerpt`), reading the capture bundle
 *  at `bundleDir` (`<demoDir>/.capture`). Pure + immutable. */
export function computeCheckpointDeltas(model: DemoModel, bundleDir: string): DemoModel {
  return {
    ...model,
    checkpoints: model.checkpoints.map((cp) => {
      const { delta, deltaExcerpt } = checkpointDelta(cp, bundleDir);
      const { deltaExcerpt: _prev, ...rest } = cp;
      return deltaExcerpt !== undefined ? { ...rest, delta, deltaExcerpt } : { ...rest, delta };
    }),
  };
}
