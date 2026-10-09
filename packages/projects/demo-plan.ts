/**
 * The demo planner's plan, validated (forge-mfv5.1.19, D-45): a form per checkpoint and one narrative, no output
 * and no evidence. Every driver must be a declared means or an AC's own inline-code span; anything else is refused
 * by row — `plan-invalid:<row>: <reason>` — with no fallback.
 */

import { SHELL_METACHARACTERS, extractDemoRoute, extractDrivableCommand } from '@forge/contracts';

import { DEMO_EVIDENCE_FORMS, isOwnServerPath, type DemoEvidenceForm, type DemoMeans } from './demo-means.ts';

export type DemoPlanCheckpoint = { form: DemoEvidenceForm; caption: string; acRef?: string; command?: string; route?: string; apiPath?: string };
export type DemoPlan = { narrative: string; checkpoints: DemoPlanCheckpoint[] };
export type AllowedDemoMeans = { commands: string[]; routes: string[]; apiPaths: string[]; apiCommands: string[] };
export type DemoPlanResult = { ok: true; plan: DemoPlan } | { ok: false; errors: string[] };

/** A narrative longer than this is a second essay, not a paragraph. */
export const NARRATIVE_MAX_WORDS = 120;
const MAX_PLAN_CHECKPOINTS = 12;

const union = (...lists: ReadonlyArray<readonly string[] | undefined>): string[] => [...new Set(lists.flatMap((l) => l ?? []))];

/** The means a plan may name: `demoMeans`, the drivable `demoProcess` capture commands, and each AC's own inline-code span. */
export function allowedDemoMeans(means: DemoMeans | undefined, acs: ReadonlyArray<{ when: string }>, processCommands: readonly string[] = []): AllowedDemoMeans {
  const acRoutes: string[] = [];
  const acCommands: string[] = [];
  for (const { when } of acs) {
    const route = extractDemoRoute(when);
    const cmd = extractDrivableCommand(when);
    if (route.routeShaped && route.route !== null) acRoutes.push(route.route);
    else if (!route.routeShaped && cmd.ok) acCommands.push(cmd.command);
  }
  return {
    commands: union(means?.commands, processCommands, acCommands),
    routes: union(means?.routes, acRoutes),
    apiPaths: union(means?.api?.paths),
    apiCommands: union(means?.api?.commands, acCommands),
  };
}

const PLAN_KEYS = ['narrative', 'checkpoints'];
const CHECKPOINT_KEYS = ['form', 'caption', 'acRef', 'command', 'route', 'apiPath'];
/** Which driver fields each form takes; every other driver field is refused. */
const DRIVERS: Record<DemoEvidenceForm, readonly string[]> = {
  'cli-before-after': ['command'], 'api-before-after': ['command', 'apiPath'], screenshot: ['route'], 'test-evidence': [],
};

// An agent value echoed into a logged, thrown error is bounded; agent prose (DEMO.md, the PR body) is one bounded line.
const shown = (v: unknown): string => JSON.stringify(v)?.slice(0, 80) ?? String(v);
const isLine = (v: unknown, max: number): boolean => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\r\n]/.test(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasHost = (v: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.includes('://');

function checkDriver(cp: Record<string, unknown>, key: string, allowed: readonly string[], at: string, errors: string[]): void {
  const v = cp[key];
  if (v === undefined) return;
  const row = `plan-invalid:${at}.${key}`;
  if (typeof v !== 'string' || v.trim() === '') return void errors.push(`${row}: must be a non-empty string`);
  if (key !== 'command' && hasHost(v)) return void errors.push(`${row}: ${shown(v)} names a host — a plan names no host, only declared means`);
  if (key === 'command' && SHELL_METACHARACTERS.test(v)) return void errors.push(`${row}: ${shown(v)} contains shell metacharacters`);
  if (key !== 'command' && !isOwnServerPath(v)) return void errors.push(`${row}: ${shown(v)} is not a path on the tree's own server`);
  if (!allowed.includes(v)) errors.push(`${row}: ${shown(v)} is not a declared means (demoMeans or an acceptance criterion's span)`);
}

function checkCheckpoint(raw: unknown, i: number, allowed: AllowedDemoMeans, errors: string[]): void {
  const at = `checkpoints[${i}]`;
  if (!isObject(raw)) return void errors.push(`plan-invalid:${at}: must be an object`);
  for (const key of Object.keys(raw)) if (!CHECKPOINT_KEYS.includes(key)) errors.push(`plan-invalid:${at}.${key.slice(0, 40)}: not a plan field — a plan carries no output or evidence`);
  if (!(DEMO_EVIDENCE_FORMS as readonly unknown[]).includes(raw.form)) return void errors.push(`plan-invalid:${at}.form: must be one of ${DEMO_EVIDENCE_FORMS.join('|')} (got ${shown(raw.form)})`);
  const form = raw.form as DemoEvidenceForm;
  if (!isLine(raw.caption, 160)) errors.push(`plan-invalid:${at}.caption: must be one line of at most 160 characters`);
  if (raw.acRef !== undefined && !(typeof raw.acRef === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(raw.acRef))) errors.push(`plan-invalid:${at}.acRef: must be a work-item id (≤ 40 of A-Z a-z 0-9 . _ -)`);
  for (const key of ['command', 'route', 'apiPath']) {
    if (raw[key] !== undefined && !DRIVERS[form].includes(key)) errors.push(`plan-invalid:${at}.${key}: form ${form} takes no ${key}`);
  }
  const drivers = DRIVERS[form].filter((k) => raw[k] !== undefined);
  if (form !== 'test-evidence' && drivers.length !== 1) errors.push(`plan-invalid:${at}: form ${form} needs exactly one of ${DRIVERS[form].join(' | ')}`);
  checkDriver(raw, 'command', form === 'api-before-after' ? allowed.apiCommands : allowed.commands, at, errors);
  checkDriver(raw, 'route', allowed.routes, at, errors);
  checkDriver(raw, 'apiPath', allowed.apiPaths, at, errors);
}

/** Validate a raw plan against the allowed means; every refusal names its row. */
export function validateDemoPlan(raw: unknown, allowed: AllowedDemoMeans): DemoPlanResult {
  if (!isObject(raw)) return { ok: false, errors: ['plan-invalid:plan: must be a JSON object'] };
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (!PLAN_KEYS.includes(key)) errors.push(`plan-invalid:plan.${key.slice(0, 40)}: not a plan field — a plan carries no output or evidence`);
  const n = raw.narrative;
  if (!isLine(n, 900)) errors.push('plan-invalid:narrative: must be one paragraph on one line, at most 900 characters');
  else if ((n as string).trim().split(/\s+/).length > NARRATIVE_MAX_WORDS) errors.push(`plan-invalid:narrative: ${(n as string).trim().split(/\s+/).length} words — at most ${NARRATIVE_MAX_WORDS}`);
  const cps = raw.checkpoints;
  if (Array.isArray(cps) && cps.length > 0 && cps.length <= MAX_PLAN_CHECKPOINTS) cps.forEach((cp, i) => checkCheckpoint(cp, i, allowed, errors));
  else errors.push(`plan-invalid:checkpoints: must be an array of 1–${MAX_PLAN_CHECKPOINTS} checkpoints`);
  if (errors.length > 20) return { ok: false, errors: [...errors.slice(0, 20), `plan-invalid:plan: …and ${errors.length - 20} more`] };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: raw as unknown as DemoPlan };
}
