/**
 * The GitHub side of a project-repo Save (forge-mfv5.1.22): is the default branch
 * protected, and the forge-studio pull request (open it, find it, read its checks
 * — forge-mfv5.1.23 —, see it merged). gh is the only GitHub client (D-02); it runs
 * through an injectable runner so tests answer with gh's real output shapes and
 * never reach the network. Calls stay synchronous, like the git ones around them,
 * each bounded by GH_TIMEOUT_MS so a hung gh fails the Save by name.
 */
import { execFileSync } from 'node:child_process';

import { parsePrRead, type PrRead } from './project-pr-verdict.ts';
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

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Only this origin's own PR URLs: github.com/<owner>/<repo>/pull/N (GitHub slugs are case-insensitive). */
const prUrlRe = (slug: string): RegExp => new RegExp(`^https://github\\.com/${escapeRe(slug)}/pull/\\d+$`, 'i');

type PrRow = { url: string; headRefOid: string };

/** forge-studio → base PRs of THIS repo. gh's `--head` matches by branch name only, so
 *  a fork's PR, another base's, or another repo's URL is dropped here (security review). */
function studioPrs(gh: GhRunner, cwd: string, slug: string, base: string, state: 'open' | 'merged'): PrRow[] | { error: string } {
  const r = gh(['pr', 'list', '--repo', slug, '--head', STUDIO_BRANCH, '--base', base, '--state', state,
    '--json', 'url,isCrossRepository,baseRefName,headRefName,headRefOid,headRepositoryOwner'], cwd);
  if (!r.ok) return { error: `gh pr list failed: ${firstLine(r.stderr)}` };
  let rows: Array<Record<string, unknown>>;
  try {
    rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  } catch {
    return { error: 'gh pr list returned unparseable output' };
  }
  const own = prUrlRe(slug);
  return rows
    .filter((row) => row.isCrossRepository === false && row.baseRefName === base && row.headRefName === STUDIO_BRANCH && typeof row.url === 'string' && own.test(row.url))
    .map((row) => ({ url: row.url as string, headRefOid: typeof row.headRefOid === 'string' ? row.headRefOid : '' }));
}

/** The open forge-studio → base PR's URL, undefined when none, or gh's failure by name. */
export function openStudioPr(gh: GhRunner, cwd: string, slug: string, base: string): string | undefined | { error: string } {
  const rows = studioPrs(gh, cwd, slug, base, 'open');
  return Array.isArray(rows) ? rows[0]?.url : rows;
}

/** A merged forge-studio → base PR — with `headOid`, only the one whose head was exactly that commit. */
export function mergedStudioPr(gh: GhRunner, cwd: string, slug: string, base: string, headOid?: string): string | undefined {
  const rows = studioPrs(gh, cwd, slug, base, 'merged');
  if (!Array.isArray(rows)) return undefined;
  return rows.find((row) => headOid === undefined || row.headRefOid === headOid)?.url;
}

export type PrOpened = { ok: true; url: string; created: boolean } | { ok: false; reason: string };

/** Reuse the open forge-studio PR or open one. Merging is Save's verdict, never requested here. */
export function openOrReuseStudioPr(gh: GhRunner, cwd: string, slug: string, base: string): PrOpened {
  const open = studioPrs(gh, cwd, slug, base, 'open');
  if (!Array.isArray(open)) return { ok: false, reason: open.error };
  if (open[0]) return { ok: true, url: open[0].url, created: false };
  const r = gh(['pr', 'create', '--repo', slug, '--base', base, '--head', STUDIO_BRANCH,
    '--title', 'forge-studio: apply project configuration',
    '--body', 'Project configuration written from Forge Studio. The default branch is protected, so Studio opened this pull request instead of pushing it.'], cwd);
  if (!r.ok) return { ok: false, reason: `gh pr create failed: ${firstLine(r.stderr)}` };
  const printed = r.stdout.trim().split('\n').map((l) => l.trim()).find((l) => prUrlRe(slug).test(l));
  return printed ? { ok: true, url: printed, created: true } : { ok: false, reason: `gh pr create printed no PR URL: ${firstLine(r.stdout)}` };
}

const PR_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){state merged mergeStateStatus headRefOid commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{__typename ...on CheckRun{name status conclusion isRequired(pullRequestNumber:$number)} ...on StatusContext{context state isRequired(pullRequestNumber:$number)}}}}}}}}}}';

/** forge-mfv5.1.23 — one graphql read (not `gh pr checks`, which exits non-zero on pending/red). */
export function readStudioPr(gh: GhRunner, cwd: string, slug: string, url: string): PrRead {
  const [owner, name] = slug.split('/');
  const r = gh(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${/\/pull\/(\d+)$/.exec(url)?.[1]}`, '-f', `query=${PR_QUERY}`], cwd);
  return r.ok ? parsePrRead(r.stdout) : { ok: false, reason: `gh api graphql failed: ${firstLine(r.stderr)}` };
}

/** The repo's `allow_auto_merge`: true, false, or undefined when unreadable or missing — never assumed. */
export function allowsAutoMerge(gh: GhRunner, cwd: string, slug: string): boolean | undefined {
  const r = gh(['api', `repos/${slug}`], cwd);
  try {
    const v = r.ok ? (JSON.parse(r.stdout) as { allow_auto_merge?: unknown }).allow_auto_merge : undefined;
    return typeof v === 'boolean' ? v : undefined;
  } catch { return undefined; }
}

/** `gh pr merge <url> <how> --repo <slug>`; a refusal carries gh's first stderr line. */
export function mergeStudioPr(gh: GhRunner, cwd: string, slug: string, url: string, how: readonly string[]): { ok: true } | { ok: false; reason: string } {
  const r = gh(['pr', 'merge', url, ...how, '--repo', slug], cwd);
  return r.ok ? { ok: true } : { ok: false, reason: firstLine(r.stderr) || 'gh pr merge failed' };
}
