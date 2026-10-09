/**
 * The GitHub side of a project-repo Save (forge-mfv5.1.22): is the default branch
 * protected, and the forge-studio pull request (open it, find it, request
 * merge-on-green, see it merged). gh is the only GitHub client (D-02); it runs
 * through an injectable runner so tests answer with gh's real output shapes and
 * never reach the network.
 */
import { execFileSync } from 'node:child_process';

import { STUDIO_BRANCH } from './project-repo-tx.ts';

export type GhResult = { ok: true; stdout: string } | { ok: false; stderr: string };
export type GhRunner = (args: readonly string[], cwd: string) => GhResult;

/** gh's own timeout ceiling for one call; a hung gh never holds a Save forever. */
const GH_TIMEOUT_MS = 60_000;

export const defaultGh: GhRunner = (args, cwd) => {
  try {
    return { ok: true, stdout: execFileSync('gh', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS }) };
  } catch (err) {
    const e = err as { stderr?: unknown; message?: string };
    const stderr = typeof e.stderr === 'string' && e.stderr.trim() ? e.stderr : (e.message ?? 'gh failed');
    return { ok: false, stderr };
  }
};

const firstLine = (s: string): string => s.trim().split('\n')[0]?.trim() ?? '';
const SLUG_PART = /^[A-Za-z0-9_.-]+$/;
const GITHUB_URL_RES = [
  /^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

/** `owner/repo` from a github.com origin URL (https or ssh form); null for anything else. */
export function githubSlug(originUrl: string): string | null {
  for (const re of GITHUB_URL_RES) {
    const m = re.exec(originUrl.trim());
    if (m && SLUG_PART.test(m[1]!) && SLUG_PART.test(m[2]!)) return `${m[1]}/${m[2]}`;
  }
  return null;
}

export type Protection = { kind: 'protected' } | { kind: 'unprotected' } | { kind: 'unknown'; reason: string };

/** `gh api repos/<slug>/branches/<base>` → `.protected`. Anything unreadable is UNKNOWN. */
export function probeProtection(gh: GhRunner, cwd: string, slug: string, base: string): Protection {
  const r = gh(['api', `repos/${slug}/branches/${base}`], cwd);
  if (!r.ok) return { kind: 'unknown', reason: firstLine(r.stderr) || 'gh api failed' };
  try {
    const p = (JSON.parse(r.stdout) as { protected?: unknown }).protected;
    if (p === true) return { kind: 'protected' };
    if (p === false) return { kind: 'unprotected' };
  } catch { /* fall through: unparseable is unknown */ }
  return { kind: 'unknown', reason: 'gh api returned no "protected" field' };
}

const PR_URL_RE = /^https:\/\/\S+\/pull\/\d+$/;

function prUrls(gh: GhRunner, cwd: string, slug: string, state: 'open' | 'merged'): string[] | { error: string } {
  const r = gh(['pr', 'list', '--repo', slug, '--head', STUDIO_BRANCH, '--state', state, '--json', 'url'], cwd);
  if (!r.ok) return { error: `gh pr list failed: ${firstLine(r.stderr)}` };
  try {
    const rows = JSON.parse(r.stdout) as Array<{ url?: unknown }>;
    return rows.map((row) => row.url).filter((u): u is string => typeof u === 'string' && PR_URL_RE.test(u));
  } catch {
    return { error: 'gh pr list returned unparseable output' };
  }
}

/** The open forge-studio → base PR's URL, or undefined (none, or gh could not say). */
export function openStudioPr(gh: GhRunner, cwd: string, slug: string): string | undefined {
  const urls = prUrls(gh, cwd, slug, 'open');
  return Array.isArray(urls) ? urls[0] : undefined;
}

/** The most recent merged forge-studio PR's URL, for naming it in a detail. */
export function mergedStudioPr(gh: GhRunner, cwd: string, slug: string): string | undefined {
  const urls = prUrls(gh, cwd, slug, 'merged');
  return Array.isArray(urls) ? urls[0] : undefined;
}

export type PrOpened = { ok: true; url: string; created: boolean; autoMerge: string } | { ok: false; reason: string };

/** Reuse the open forge-studio PR or open one, then request merge-on-green. A
 *  repo without auto-merge leaves the PR open — said, never an error. */
export function openStudioPrWithAutoMerge(gh: GhRunner, cwd: string, slug: string, base: string): PrOpened {
  const open = prUrls(gh, cwd, slug, 'open');
  if (!Array.isArray(open)) return { ok: false, reason: open.error };
  let url = open[0];
  const created = url === undefined;
  if (url === undefined) {
    const r = gh(['pr', 'create', '--repo', slug, '--base', base, '--head', STUDIO_BRANCH,
      '--title', 'forge-studio: apply project configuration',
      '--body', 'Project configuration written from Forge Studio. The default branch is protected, so Studio opened this pull request instead of pushing it.'], cwd);
    if (!r.ok) return { ok: false, reason: `gh pr create failed: ${firstLine(r.stderr)}` };
    const printed = r.stdout.trim().split('\n').map((l) => l.trim()).find((l) => PR_URL_RE.test(l));
    if (!printed) return { ok: false, reason: `gh pr create printed no PR URL: ${firstLine(r.stdout)}` };
    url = printed;
  }
  const m = gh(['pr', 'merge', url, '--auto', '--merge', '--repo', slug], cwd);
  const autoMerge = m.ok ? 'auto-merge requested' : `auto-merge not enabled (${firstLine(m.stderr)}) — PR left open, merge it on GitHub`;
  return { ok: true, url, created, autoMerge };
}
