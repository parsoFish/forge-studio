/**
 * `demoMeans` (bead forge-mfv5.1.19): what a demo of this project MAY drive —
 * never which evidence form a change gets (the planner picks that; the
 * orchestrator proves it, D-15). A sibling of `demoProcess`, whose steps stay
 * the Studio demo-builder's declaration.
 *
 * `api.paths` are GETs on each capture tree's OWN started server, never a
 * declared external host: one fixed external base reads the same live resource
 * for before and after, so the control would always say 'unchanged'. A live
 * external API is reached through `api.commands` — the project's own CLI, which
 * holds its own credentials and prints JSON.
 */

import { SHELL_METACHARACTERS, isSafeDemoRoute } from '@forge/contracts';

/** The closed set of evidence forms a demo checkpoint may take; the planner picks one per checkpoint. */
export const DEMO_EVIDENCE_FORMS = ['cli-before-after', 'api-before-after', 'screenshot', 'test-evidence'] as const;
export type DemoEvidenceForm = (typeof DEMO_EVIDENCE_FORMS)[number];

export type DemoMeans = {
  commands?: string[];
  routes?: string[];
  api?: { paths?: string[]; commands?: string[]; ignoreKeys?: string[] };
};

/** An in-app path on the tree's own server: absolute, no traversal, no host. */
export function isOwnServerPath(path: string): boolean {
  return isSafeDemoRoute(path) && !path.startsWith('//');
}

function closedKeys(obj: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`project-config: ${at}.${key} is not a declared means (allowed: ${allowed.join(', ')})`);
  }
}

function stringList(v: unknown, at: string, check: (s: string, where: string) => void): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw new Error(`project-config: ${at} must be an array of strings`);
  v.forEach((s: string, i) => check(s, `${at}[${i}]`));
  return [...v];
}

const command = (s: string, at: string): void => {
  if (s.trim() === '') throw new Error(`project-config: ${at} is empty`);
  if (SHELL_METACHARACTERS.test(s)) throw new Error(`project-config: ${at} \`${s}\` contains shell metacharacters — capture runs a bare argv with no shell`);
};
const route = (s: string, at: string): void => {
  if (!isOwnServerPath(s)) throw new Error(`project-config: ${at} ${JSON.stringify(s)} must be an absolute in-app path with no traversal`);
};
const apiPath = (s: string, at: string): void => {
  if (!isOwnServerPath(s)) throw new Error(`project-config: ${at} ${JSON.stringify(s)} must be a path on the tree's own server — no scheme, host or traversal`);
};
const keyName = (s: string, at: string): void => {
  if (s.trim() === '' || s.includes('.')) throw new Error(`project-config: ${at} ${JSON.stringify(s)} must be a bare key name (matched at any depth)`);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse `demoMeans`; throws naming the first offending entry. */
export function parseDemoMeans(v: unknown): DemoMeans | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObject(v)) throw new Error('project-config: demoMeans must be an object');
  closedKeys(v, ['commands', 'routes', 'api'], 'demoMeans');
  const commands = stringList(v.commands, 'demoMeans.commands', command);
  const routes = stringList(v.routes, 'demoMeans.routes', route);
  let api: DemoMeans['api'];
  if (v.api !== undefined) {
    if (!isObject(v.api)) throw new Error('project-config: demoMeans.api must be an object');
    closedKeys(v.api, ['paths', 'commands', 'ignoreKeys'], 'demoMeans.api');
    const paths = stringList(v.api.paths, 'demoMeans.api.paths', apiPath);
    const apiCommands = stringList(v.api.commands, 'demoMeans.api.commands', command);
    const ignoreKeys = stringList(v.api.ignoreKeys, 'demoMeans.api.ignoreKeys', keyName);
    api = { ...(paths ? { paths } : {}), ...(apiCommands ? { commands: apiCommands } : {}), ...(ignoreKeys ? { ignoreKeys } : {}) };
  }
  return { ...(commands ? { commands } : {}), ...(routes ? { routes } : {}), ...(api ? { api } : {}) };
}
