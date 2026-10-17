/**
 * `demoMeans.portal` (forge-8vfn.31, D-45 amended): a third-party portal the project configures is a means —
 * exact origins, literal pages opened on the first origin, the project's own `apply` commands, and an
 * operator-held Playwright storage state named by an env var. `apply` is required: capture runs it from each
 * tree before that tree's frames, so the live portal shows what that tree declares — without it before and
 * after read one live state and the control always says unchanged (D-45's rejected case).
 */

import { SHELL_METACHARACTERS, isSafeDemoRoute } from '@forge/contracts';

export type DemoPortal = { origins: string[]; pages: string[]; apply: string[]; authState?: string };

const PORTAL_KEYS = ['origins', 'pages', 'apply', 'authState'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function nonEmptyStrings(v: unknown, at: string, noun: string): string[] {
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw new Error(`project-config: ${at} must be an array of strings`);
  if (v.length === 0) throw new Error(`project-config: ${at} must declare at least one ${noun}`);
  return [...v];
}

/** `scheme://host[:port]` exactly as `URL#origin` prints it; https anywhere, http only on loopback. */
export function checkPortalOrigin(s: string, at: string): void {
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new Error(`project-config: ${at} ${JSON.stringify(s)} must be an exact origin such as "https://github.com"`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.origin === 'null') {
    throw new Error(`project-config: ${at} ${JSON.stringify(s)} must be an exact origin such as "https://github.com"`);
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`project-config: ${at} ${JSON.stringify(s)} must use https (plain http only on a loopback host)`);
  }
  if (s !== url.origin) throw new Error(`project-config: ${at} ${JSON.stringify(s)} is not an exact origin — write it as ${JSON.stringify(url.origin)}`);
}

/** A literal absolute path under the declared origin: no host, no template, no traversal (plain or encoded). */
export function checkPortalPage(s: string, at: string): void {
  if (/\.\.|%2e/i.test(s)) throw new Error(`project-config: ${at} ${JSON.stringify(s)} contains traversal`);
  if (!isSafeDemoRoute(s) || s.startsWith('//')) {
    throw new Error(`project-config: ${at} ${JSON.stringify(s)} must be a literal path under the declared origin, starting "/" (no host, no placeholder)`);
  }
}

/** The apply sequence: bare argvs run in order from the tree under capture, each through `run` like any command. */
function parseApply(v: unknown): string[] {
  if (typeof v === 'string') throw new Error(`project-config: demoMeans.portal.apply must be a list of commands run in order, such as ["gw reset", "gw apply"] (got one string ${JSON.stringify(v)})`);
  if (v === undefined || (Array.isArray(v) && v.length === 0)) {
    throw new Error('project-config: demoMeans.portal.apply is required — the commands that make the portal show the tree under capture, run from each tree before its frames');
  }
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw new Error('project-config: demoMeans.portal.apply must be an array of strings');
  v.forEach((s: string, i) => {
    if (s.trim() === '') throw new Error(`project-config: demoMeans.portal.apply[${i}] is empty`);
    if (SHELL_METACHARACTERS.test(s)) throw new Error(`project-config: demoMeans.portal.apply[${i}] \`${s}\` contains shell metacharacters — capture runs a bare argv with no shell`);
  });
  return [...v];
}

/** Parse `demoMeans.portal`; throws naming the first offending entry. */
export function parseDemoPortal(v: unknown): DemoPortal | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) throw new Error('project-config: demoMeans.portal must be an object');
  for (const key of Object.keys(v)) {
    if (!PORTAL_KEYS.includes(key)) throw new Error(`project-config: demoMeans.portal.${key} is not a declared means (allowed: ${PORTAL_KEYS.join(', ')})`);
  }
  const origins = nonEmptyStrings(v.origins, 'demoMeans.portal.origins', 'origin');
  origins.forEach((o, i) => checkPortalOrigin(o, `demoMeans.portal.origins[${i}]`));
  const pages = nonEmptyStrings(v.pages, 'demoMeans.portal.pages', 'page');
  pages.forEach((p, i) => checkPortalPage(p, `demoMeans.portal.pages[${i}]`));
  const apply = parseApply(v.apply);
  if (v.authState !== undefined && !(typeof v.authState === 'string' && ENV_NAME.test(v.authState))) {
    throw new Error(`project-config: demoMeans.portal.authState ${JSON.stringify(v.authState)} names an environment variable, not a path (such as GW_PORTAL_STATE)`);
  }
  return { origins, pages, apply, ...(v.authState !== undefined ? { authState: v.authState as string } : {}) };
}
