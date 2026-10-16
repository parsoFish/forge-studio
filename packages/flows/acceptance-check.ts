/**
 * forge-mfv5.1.43 (D-20 amended) — the falsifying check an operator-authored
 * acceptance criterion carries. A typed send-back's or Kickoff-added work
 * item's criterion is a CHECK, not advice: `check.argv` is one runnable command
 * (argv, never a shell string), `expect` says whether it must pass or fail, and
 * `unsetEnv` / `requiresEnv` reach the same gate seams the work-item gate uses
 * — so "the suite FAILS without GW_CALLER_TOKEN" is expressible. The dev loop
 * runs every check at work-item close (`@forge/stations` wi-quality-gate) and
 * forge, never the agent, ticks the box from the result.
 */
import { gateIsShellPipeline, type AcceptanceCriterion } from './work-item.ts';

export type AcceptanceCheck = {
  argv: string[];
  expect: 'pass' | 'fail';
  unsetEnv?: string[];
  requiresEnv?: string[];
};

const AC_ID = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** The criterion's name in the WI file, events and refusals: its declared id, else `AC<n>`. */
export function acLabel(ac: Pick<AcceptanceCriterion, 'id'>, index: number): string {
  return ac.id ?? `AC${index + 1}`;
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

function checkErrors(label: string, c: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!strings(c.argv) || c.argv.length === 0) errors.push(`${label}: check.argv must be a non-empty array of non-empty strings`);
  else if (gateIsShellPipeline(c.argv)) errors.push(`${label}: check.argv must be ONE runnable command — not a shell pipeline or chain (bash -c "… | …", &&, ;)`);
  if (c.expect !== 'pass' && c.expect !== 'fail') errors.push(`${label}: check.expect must be pass | fail, got ${String(c.expect)}`);
  for (const k of ['unsetEnv', 'requiresEnv'] as const) {
    if (c[k] !== undefined && !(strings(c[k]) && c[k].every((n) => ENV_NAME.test(n)))) errors.push(`${label}: check.${k} must be env var names (${ENV_NAME.source})`);
  }
  const known = new Set(['argv', 'expect', 'unsetEnv', 'requiresEnv']);
  for (const k of Object.keys(c)) if (!known.has(k)) errors.push(`${label}: check.${k} is not a check field (argv, expect, unsetEnv, requiresEnv)`);
  return errors;
}

/** Every malformed id or check across a work item's criteria, each naming its criterion. Pure. */
export function acceptanceCheckErrors(acs: readonly AcceptanceCriterion[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  acs.forEach((ac, i) => {
    if (ac.id !== undefined && !(typeof ac.id === 'string' && AC_ID.test(ac.id))) errors.push(`acceptance_criteria[${i}].id must match ${AC_ID.source}: got ${String(ac.id)}`);
    const label = acLabel(ac, i);
    if (seen.has(label)) errors.push(`acceptance_criteria: duplicate criterion id ${label}`);
    seen.add(label);
    if (ac.check === undefined) return;
    if (typeof ac.check !== 'object' || ac.check === null) errors.push(`${label}: check must be an object`);
    else errors.push(...checkErrors(label, ac.check as unknown as Record<string, unknown>));
  });
  return errors;
}

/** An operator-authored work item's criteria that carry no check — prose is refused there, never advisory. Pure. */
export function missingCheckErrors(acs: readonly AcceptanceCriterion[]): string[] {
  return acs.flatMap((ac, i) => (ac.check === undefined
    ? [`${acLabel(ac, i)} (when: ${ac.when.trim()}) has no falsifying check — an operator-authored work item's criterion must carry check: { argv, expect: pass | fail, unsetEnv?, requiresEnv? }`]
    : []));
}

/** The criterion's frontmatter object: `id`/`check` only when declared, so a check-less criterion stays byte-identical. */
export function serializeCriterion(c: AcceptanceCriterion): Record<string, unknown> {
  return { ...(c.id !== undefined ? { id: c.id } : {}), given: c.given, when: c.when, then: c.then, ...(c.check !== undefined ? { check: c.check } : {}) };
}

/** Parse a frontmatter criterion's optional `id` and `check` verbatim; validation names what is wrong. */
export function parseCriterionExtras(obj: Record<string, unknown>): Pick<AcceptanceCriterion, 'id' | 'check'> {
  return {
    ...(obj.id !== undefined ? { id: obj.id as string } : {}),
    ...(obj.check !== undefined ? { check: obj.check as AcceptanceCheck } : {}),
  };
}

export const TICKED_HEADING = '## Acceptance checks passed (ticked by forge)';

/** `- [ ] <label>:` → `- [x] <label>:` for each label; a label with no box is appended under {@link TICKED_HEADING}. Pure. */
export function tickAcceptanceCriteria(body: string, labels: readonly string[]): string {
  let out = body;
  const missing: string[] = [];
  for (const label of labels) {
    const box = `- [ ] ${label}:`;
    if (out.includes(box)) out = out.split(box).join(`- [x] ${label}:`);
    else if (!out.includes(`- [x] ${label}:`)) missing.push(label);
  }
  if (missing.length === 0) return out;
  return `${out.replace(/\n*$/, '\n')}\n${TICKED_HEADING}\n\n${missing.map((l) => `- [x] ${l}: check passed`).join('\n')}\n`;
}
