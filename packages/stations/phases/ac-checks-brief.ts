import { parseGateTestSummary, type GateRunInfo } from '@forge/agents';

import type { AcCheckRun, AcGateRunInfo } from './wi-quality-gate.ts';

/**
 * forge-mfv5.1.55 — the ONE verdict a gate pass with per-AC checks hands the
 * brief: every unsatisfied check (id, expect, exit or ERRORED/TIMED OUT, the
 * runner's summary, bounded tails), never only the first. I4 WI-17 learned one
 * gap per ~$2 iteration while the loop stopped at the first.
 */

/** The checks' brief budget (bytes): fixed lines first, the tails split fairly across the unsatisfied checks, each ≤ the per-stream cap. */
export const CHECKS_BRIEF_MAX = 16_384;
const PER_STREAM_MAX = 1_024;
const COMMAND_MAX = 300;
/** The cap is printed in each capped header; measured at 0, it may print up to this many more digits. */
const CAP_DIGITS = 4;

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

function status(info: GateRunInfo): string {
  if (info.timedOut) return 'TIMED OUT (environment — not a pass)';
  if (info.errored) return `ERRORED (${info.rejectReason ?? 'gate-errored'}) — the check could not run; reported, never a pass`;
  return `exit ${info.exitCode}${info.rejectReason ? ` (${info.rejectReason})` : ''}`;
}

function stream(name: string, text: string, cap: number): string[] {
  if (text === '') return [`--- ${name}: (empty)`];
  if (text.length <= cap) return [`--- ${name}`, text];
  return [`--- ${name} (last ${cap} of ${text.length} bytes — capped: the ${CHECKS_BRIEF_MAX}-byte checks brief is shared by every unsatisfied check)`, text.slice(text.length - cap)];
}

function section(r: AcCheckRun, cap: number): string[] {
  const s = parseGateTestSummary(`${r.info.stdoutTail}\n${r.info.stderrTail}`);
  return [
    `=== ${r.label} (expect ${r.expect}) — ${status(r.info)}`,
    `command: ${clip(r.info.command, COMMAND_MAX)}`,
    `summary: ${s ? `${s.runner} ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped` : 'no recognised runner summary'}`,
    ...stream('stdout', r.info.stdoutTail, cap),
    ...stream('stderr', r.info.stderrTail, cap),
    '',
  ];
}

/** Every section at tail cap 0 measures the fixed text; the tails share what is left of the budget (0 when headers alone fill it). */
function composeBody(headline: string, bad: readonly AcCheckRun[]): string {
  const lines = [`[forge ac-checks] ${headline} — every check ran; fix them ALL (the work item closes only when its gate and every check pass).`, ''];
  const fixed = [...lines, ...bad.flatMap((r) => section(r, 0))].join('\n').length;
  const cap = Math.max(0, Math.min(PER_STREAM_MAX, Math.floor((CHECKS_BRIEF_MAX - fixed - CAP_DIGITS * 2 * bad.length) / (2 * bad.length))));
  return [...lines, ...bad.flatMap((r) => section(r, cap))].join('\n');
}

/**
 * Compose the checks' verdict. `passed` ⇔ every check satisfied. `errored` /
 * `timedOut` only when EVERY unsatisfied check could not run — nothing the agent
 * can fix this pass, so the loop stops as a broken gate; a fixable failure beside
 * an errored check keeps iterating, the errored one named in the brief.
 */
export function composeAcChecksVerdict(runs: readonly AcCheckRun[], iteration: number | undefined): AcGateRunInfo {
  const bad = runs.filter((r) => !r.satisfied);
  const ids = bad.map((r) => r.label).join(', ');
  const headline = `${bad.length} of ${runs.length} acceptance checks unsatisfied${bad.length > 0 ? `: ${ids}` : ''}`;
  const unrunnable = bad.length > 0 && bad.every((r) => r.info.errored || r.info.timedOut);
  const fixable = bad.find((r) => !r.info.errored && !r.info.timedOut);
  return {
    passed: bad.length === 0,
    exitCode: bad.length === 0 ? 0 : (fixable ?? bad[0]!).info.exitCode,
    durationMs: runs.reduce((n, r) => n + r.info.durationMs, 0),
    stdoutTail: '',
    stderrTail: bad.length === 0 ? '' : composeBody(headline, bad),
    command: `per-AC checks — ${headline}`,
    ...(unrunnable && bad.some((r) => r.info.timedOut) ? { timedOut: true } : unrunnable ? { errored: true } : {}),
    ...(iteration !== undefined ? { iteration } : {}),
  };
}
