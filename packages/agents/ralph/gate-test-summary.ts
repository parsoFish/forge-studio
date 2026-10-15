/**
 * Did the gate's test runner execute anything? (forge-mfv5.1.38) gitweave I3b's
 * live-acceptance gates printed "1 skipped in 0.01s" with exit 0 and passed: a
 * run that executed zero tests proves nothing. Parses the runner's OWN summary
 * — pytest, vitest, node:test, go test -v — never a guess; an acceptance gate whose output
 * carries none is refused by name (§6.15).
 */

export type GateTestSummary = { runner: 'pytest' | 'vitest' | 'node:test' | 'go test -v'; passed: number; failed: number; skipped: number; skipReasons: string[] };

const count = (text: string, re: RegExp): number => Number(re.exec(text)?.[1] ?? 0);

function nodeTest(out: string): GateTestSummary | null {
  if (!/^# pass \d+$/m.test(out)) return null;
  const skipReasons = [...out.matchAll(/^\s*ok \d+ - (.+?) # SKIP\s*(.*)$/gm)].map((m) => (m[2] ? `${m[1]} — ${m[2]}` : m[1]!));
  return { runner: 'node:test', passed: count(out, /^# pass (\d+)$/m), failed: count(out, /^# fail (\d+)$/m), skipped: count(out, /^# skipped (\d+)$/m), skipReasons };
}

function vitest(out: string): GateTestSummary | null {
  const line = [...out.matchAll(/^\s*Tests\s+(.+?)\s+\(\d+\)\s*$/gm)].at(-1)?.[1];
  if (!line) return null;
  return { runner: 'vitest', passed: count(line, /(\d+) passed/), failed: count(line, /(\d+) failed/), skipped: count(line, /(\d+) skipped/), skipReasons: [] };
}

function pytest(out: string): GateTestSummary | null {
  const line = out.split('\n').reverse().find((l) => /\b\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed)\b.* in [\d.]+s\b/.test(l));
  if (!line) return null;
  const n = (w: string): number => count(line, new RegExp(`(\\d+) ${w}\\b`));
  return {
    runner: 'pytest', passed: n('passed') + n('xfailed') + n('xpassed'), failed: n('failed') + n('errors?'), skipped: n('skipped'),
    skipReasons: [...out.matchAll(/^SKIPPED \[\d+\] (.+)$/gm)].map((m) => m[1]!.trim()),
  };
}

function goVerbose(out: string): GateTestSummary | null {
  if (!/^\s*--- (?:PASS|FAIL|SKIP): /m.test(out)) return null;
  const n = (w: string): number => (out.match(new RegExp(`^\\s*--- ${w}: `, 'gm')) ?? []).length;
  const skipReasons = [...out.matchAll(/^\s*--- SKIP: (\S+)[^\n]*\n\s+\S+\.go:\d+: (.+)$/gm)].map((m) => `${m[1]} — ${m[2]}`);
  return { runner: 'go test -v', passed: n('PASS'), failed: n('FAIL'), skipped: n('SKIP'), skipReasons };
}

/** The runner's own counts, or null when the output carries no summary this module recognises. */
export function parseGateTestSummary(output: string): GateTestSummary | null {
  return nodeTest(output) ?? vitest(output) ?? goVerbose(output) ?? pytest(output);
}

/** Why an exit-0 gate is NOT a pass, or null when its runner executed tests (or it is no test run at all). */
export function judgeGateTestSummary(output: string, opts: { acceptance: boolean }): string | null {
  const s = parseGateTestSummary(output);
  if (!s) return opts.acceptance ? 'acceptance gate output carries no recognised test summary (pytest, vitest, node:test, go test -v) — forge cannot prove a test ran' : null;
  if (s.passed + s.failed > 0) return null;
  const why = s.skipReasons.length > 0 ? s.skipReasons.join('; ') : `no skip reasons in the output${s.runner === 'pytest' ? ' (run pytest with -rs to print them)' : ''}`;
  return `gate ran 0 tests — ${s.skipped} skipped (${s.runner}): ${why}`;
}
