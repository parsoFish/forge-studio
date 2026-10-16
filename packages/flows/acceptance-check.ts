/**
 * forge-mfv5.1.43 (D-20 amended) — the falsifying check an operator-authored acceptance criterion
 * carries: one runnable command (argv, never a shell string) that must pass or fail, with env vars to
 * unset or require through the work-item gate's own seams. The dev loop runs every check at close
 * (`@forge/stations` wi-quality-gate) and forge, never the agent, ticks the criterion's box.
 */
import { gateIsShellPipeline, type AcceptanceCriterion } from './work-item.ts';

export type AcceptanceCheck = { argv: string[]; expect: 'pass' | 'fail'; unsetEnv?: string[]; requiresEnv?: string[] };

const AC_ID = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

/** The criterion's name in the WI file, events and refusals: its declared id, else `AC<n>`. */
export function acLabel(ac: Pick<AcceptanceCriterion, 'id'>, index: number): string {
  return ac.id ?? `AC${index + 1}`;
}

function checkErrors(label: string, c: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!strings(c.argv) || c.argv.length === 0 || c.argv.length > 64 || c.argv.some((t) => t.length > 500)) errors.push(`${label}: check.argv must be 1..64 non-empty strings of at most 500 characters`);
  else if (gateIsShellPipeline(c.argv)) errors.push(`${label}: check.argv must be ONE runnable command — not a shell pipeline or chain (bash -c "… | …", &&, ;)`);
  if (c.expect !== 'pass' && c.expect !== 'fail') errors.push(`${label}: check.expect must be pass | fail, got ${String(c.expect)}`);
  for (const k of ['unsetEnv', 'requiresEnv'] as const) {
    if (c[k] !== undefined && !(strings(c[k]) && c[k].every((n) => ENV_NAME.test(n)))) errors.push(`${label}: check.${k} must be env var names (${ENV_NAME.source})`);
  }
  return errors;
}

/** Every malformed id or check across a work item's criteria, each naming its criterion. Pure. */
export function acceptanceCheckErrors(acs: readonly AcceptanceCriterion[]): string[] {
  const seen = new Set<string>();
  return acs.flatMap((ac, i) => {
    const label = acLabel(ac, i);
    const errors = ac.id !== undefined && !(typeof ac.id === 'string' && AC_ID.test(ac.id)) ? [`acceptance_criteria[${i}].id must match ${AC_ID.source}: got ${String(ac.id)}`] : [];
    if (seen.has(label)) errors.push(`acceptance_criteria: duplicate criterion id ${label}`);
    seen.add(label);
    if (ac.check !== undefined) errors.push(...(typeof ac.check === 'object' && ac.check !== null ? checkErrors(label, ac.check as unknown as Record<string, unknown>) : [`${label}: check must be an object`]));
    return errors;
  });
}

/** An operator-authored work item's criteria that carry no check — prose is refused there, never advisory. Pure. */
export function missingCheckErrors(acs: readonly AcceptanceCriterion[]): string[] {
  return acs.flatMap((ac, i) => (ac.check === undefined
    ? [`${acLabel(ac, i)} (when: ${ac.when.trim()}) has no falsifying check — an operator-authored work item's criterion must carry check: { argv, expect: pass | fail, unsetEnv?, requiresEnv? }`]
    : []));
}

/** Frontmatter object; `id`/`check` only when declared, so a check-less criterion stays byte-identical. */
export function serializeCriterion(c: AcceptanceCriterion): Record<string, unknown> {
  return { ...(c.id !== undefined ? { id: c.id } : {}), given: c.given, when: c.when, then: c.then, ...(c.check !== undefined ? { check: c.check } : {}) };
}

/** A frontmatter criterion's optional `id` and `check`, verbatim; validation names what is wrong. */
export function parseCriterionExtras(obj: Record<string, unknown>): Pick<AcceptanceCriterion, 'id' | 'check'> {
  return { ...(obj.id !== undefined ? { id: obj.id as string } : {}), ...(obj.check !== undefined ? { check: obj.check as AcceptanceCheck } : {}) };
}

/** `- [ ] <label>:` → `- [x] <label>:` per label; a label with no box is appended under a forge heading. Pure. */
export function tickAcceptanceCriteria(body: string, labels: readonly string[]): string {
  const missing = labels.filter((l) => !body.includes(`- [ ] ${l}:`) && !body.includes(`- [x] ${l}:`));
  const ticked = labels.reduce((b, l) => b.split(`- [ ] ${l}:`).join(`- [x] ${l}:`), body);
  if (missing.length === 0) return ticked;
  return `${ticked.replace(/\n*$/, '\n')}\n## Acceptance checks passed (ticked by forge)\n\n${missing.map((l) => `- [x] ${l}: check passed`).join('\n')}\n`;
}
