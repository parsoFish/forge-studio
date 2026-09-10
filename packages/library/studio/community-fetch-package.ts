/**
 * M6-D / operator ruling 477 (shape A, as corrected by 582) — FETCH a community
 * skill package from its declared upstream and VENDOR it, so that "install by
 * URL" ends in an install rather than an outbound link.
 *
 * This is the trust gate's missing FIRST step and nothing else: everything
 * downstream — scan, `needs-review`, the operator's approval — already existed
 * and is unchanged. The design record is `packages/library/design.md`
 * §"Install by URL fetches through the ONE allowlisted seam, and the URL is
 * never the target": why the operator's URL is never a request target, why
 * this reads the git trees API rather than walking `contents`, and where the
 * credential lives. Three facts that must be read HERE, beside the code:
 *
 *   - Every request goes through `fetchAllowedApiUrl` — the origin-allowlisted,
 *     redirect-manual, timeout-bounded seam the refresh already used. This
 *     module opens no second one.
 *   - The caps are enforced against the TREE's declared sizes, before any blob
 *     is fetched. Two tests count blob requests to keep that true.
 *   - Text only, inherited rather than invented: `PackageFile.body` is a string
 *     and `installSkillPackage` already refuses a file that is not valid UTF-8,
 *     so a binary asset is refused here, one step earlier, with the file named.
 *
 * KNOWN LIMIT, recorded rather than discovered later: when a repo publishes its
 * SKILL.md at the ROOT, the package IS the repository — every blob under `''`
 * is vendored, `.github/` and all. The caps bound it (500 files, 5 MiB) and
 * nothing scopes it further, because a repo-root package has no declared
 * boundary to scope to. A row that wants a subset publishes under
 * `skills/<id>/`, which this prefers when both exist.
 *
 * This is a community-surface file: `community-no-trust-decisions.test.ts`
 * scans its SOURCE TEXT for the five identifiers that can turn a quarantined
 * draft into a trusted object. It owns no trust decision, and does not spell
 * their names.
 */

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

import { assertSkillSlug } from '@forge/kernel/ids.ts';

import {
  CommunityRefreshError,
  assertGithubOk,
  fetchAllowedApiUrl,
  readJson,
  GH_TOKEN_ENV,
  type CommunityRefreshErrorKind,
  type RequestCtx,
} from './community-refresh-api.ts';
import { parseCommunityUpstream } from './community-source-url.ts';
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, type PackageFile } from './skill-package.ts';
import { vendoredPackageDir } from './community-index.ts';

/** The credential, or the same up-front refusal `fetchGithubRepo` makes. An
 *  empty token interpolated into `Bearer ` earns a 401, which `assertGithubOk`
 *  honestly reports as "GitHub rejected the credential" — the wrong remedy for
 *  an operator who has not set one. `assertGithubOk` was extracted to stop the
 *  two GitHub callers drifting; the ABSENCE policy has to travel with it. */
function requireToken(ctx: RequestCtx): string {
  if (ctx.token === undefined || ctx.token === '') {
    throw new CommunityRefreshError(
      'missing-token',
      `${GH_TOKEN_ENV} is not set in this process's environment, and installing by URL reads the package through the GitHub API. Export a GitHub token with public repo read access (${GH_TOKEN_ENV}=…) and retry. Nothing was fetched or written. (${GH_TOKEN_ENV} is deliberately NOT on AGENT_ENV_ALLOWLIST — only the orchestrator process reads it, never a spawned agent.)`,
    );
  }
  return ctx.token;
}

const GITHUB_API_HEADERS = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'forge-community-install',
  Authorization: `Bearer ${token}`,
});

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/** Wall-clock budget for ONE install's whole fetch, across every request it
 *  makes. `ctx.timeoutMs` bounds a single hop; without a total, a package of
 *  500 files whose upstream answers slowly can hold the route for hours, and a
 *  package whose LAST blob is not UTF-8 downloads all 500 before refusing —
 *  costing ~500 of the operator's 5,000/hr authenticated quota per attempt,
 *  with nothing vendored to stop a retry. */
export const MAX_FETCH_WALL_MS = 120_000;

/** A fetched, not-yet-vendored package.
 *
 *  `ref` is the TREE SHA the bytes came from, not the branch name. A branch
 *  name names nothing: an upstream force-push changes the bytes while
 *  `provenance.upstreamRef` stays byte-identical, so the one field meant to
 *  say WHAT was installed would not.
 *
 *  `resolvedUrl` is the canonical `https://github.com/<owner>/<repo>` for the
 *  identity actually requested — never the raw operator string, which can be
 *  written to look like a different repository than the one it parses to
 *  (`.../anthropics/skills/%2e%2e/%2e%2e/attacker/evil` resolves to
 *  `attacker/evil`). The provenance record and the operator-facing link both
 *  use this. */
export interface FetchedPackage {
  files: PackageFile[];
  ref: string;
  resolvedUrl: string;
}

/** Why a fetch did not produce a package. Every arm is an EXPECTED failure and
 *  is RETURNED, never thrown — `runCommunityRefresh`'s own discipline, so a
 *  surface can render one remedy per reason without parsing prose. */
export type FetchPackageOutcome =
  | { ok: true; package: FetchedPackage }
  | { ok: false; reason: 'not-github'; message: string }
  | { ok: false; reason: 'no-skill-package'; message: string }
  | { ok: false; reason: 'tree-truncated'; message: string }
  | { ok: false; reason: 'too-many-files'; message: string }
  | { ok: false; reason: 'too-many-bytes'; message: string }
  | { ok: false; reason: 'fetch-failed'; kind: CommunityRefreshErrorKind; message: string };

interface TreeEntry {
  path: string;
  sha: string;
  size: number;
}

/** The three places a repo may publish the package for `id`, in the order they
 *  are tried. Named as data so the refusal can list them back to the operator
 *  rather than describing them in prose that can drift from the code. */
function candidateRoots(id: string): readonly string[] {
  return ['SKILL.md', `skills/${id}/SKILL.md`, `${id}/SKILL.md`];
}

async function fetchDefaultBranch(ctx: RequestCtx, owner: string, repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await fetchAllowedApiUrl(ctx, url, GITHUB_API_HEADERS(requireToken(ctx)));
  assertGithubOk(res, `repository "${owner}/${repo}"`);
  const body = await readJson(res, 'GitHub repo');
  const branch = body['default_branch'];
  if (typeof branch !== 'string' || branch === '') {
    throw new CommunityRefreshError('malformed-response', `GitHub's response for "${owner}/${repo}" carries no default_branch.`);
  }
  return branch;
}

async function fetchTree(ctx: RequestCtx, owner: string, repo: string, ref: string): Promise<{ entries: TreeEntry[]; truncated: boolean; sha: string }> {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const res = await fetchAllowedApiUrl(ctx, url, GITHUB_API_HEADERS(requireToken(ctx)));
  assertGithubOk(res, `tree "${ref}" of "${owner}/${repo}"`);
  const body = await readJson(res, 'GitHub tree');
  const raw = body['tree'];
  if (!Array.isArray(raw)) {
    throw new CommunityRefreshError('malformed-response', `GitHub's tree listing for "${owner}/${repo}" carries no tree array.`);
  }
  const entries: TreeEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    // A git SYMLINK is a blob (mode 120000), not a separate type — only a
    // submodule is `commit`. Filtering on `type` alone would let a symlink
    // through; it is harmless today because this extractor only ever calls
    // `writeFileSync` (the link target lands as a regular file's contents, and
    // nothing escapes), but a filter whose comment claims to exclude symlinks
    // and does not is how that stops being true. So the mode is checked.
    if (e['type'] !== 'blob') continue;
    if (e['mode'] !== '100644' && e['mode'] !== '100755') continue;
    if (typeof e['path'] !== 'string' || typeof e['sha'] !== 'string') continue;
    entries.push({ path: e['path'], sha: e['sha'], size: typeof e['size'] === 'number' ? e['size'] : 0 });
  }
  const sha = typeof body['sha'] === 'string' && body['sha'] !== '' ? body['sha'] : ref;
  return { entries, truncated: body['truncated'] === true, sha };
}

async function fetchBlob(ctx: RequestCtx, owner: string, repo: string, entry: TreeEntry): Promise<string> {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/git/blobs/${encodeURIComponent(entry.sha)}`;
  const res = await fetchAllowedApiUrl(ctx, url, GITHUB_API_HEADERS(requireToken(ctx)));
  assertGithubOk(res, `blob "${entry.path}" of "${owner}/${repo}"`);
  const body = await readJson(res, 'GitHub blob');
  if (body['encoding'] !== 'base64' || typeof body['content'] !== 'string') {
    throw new CommunityRefreshError(
      'malformed-response',
      `GitHub's blob response for "${entry.path}" is not the base64 the API documents (encoding: ${String(body['encoding'])}).`,
    );
  }
  try {
    return UTF8_DECODER.decode(Buffer.from(body['content'], 'base64'));
  } catch {
    throw new CommunityRefreshError(
      'malformed-response',
      `"${entry.path}" is not valid UTF-8 — binary package files are not supported (the same rule installSkillPackage applies one step later).`,
    );
  }
}

/** SKILL.md first, then lexicographic — `readSkillPackage`'s AT-11 order, so a
 *  fetched package and a re-read one enumerate identically. */
function packageOrder(a: PackageFile, b: PackageFile): number {
  if (a.path === 'SKILL.md') return -1;
  if (b.path === 'SKILL.md') return 1;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export async function fetchCommunitySkillPackage(ctx: RequestCtx, sourceUrl: string, id: string): Promise<FetchPackageOutcome> {
  assertSkillSlug(id);

  const upstream = parseCommunityUpstream(sourceUrl);
  if (upstream === null || upstream.kind !== 'github') {
    return {
      ok: false,
      reason: 'not-github',
      message:
        `"${sourceUrl}" is not a GitHub repository URL forge can fetch a package from. ` +
        `Install by URL reads the package through the GitHub API; an npm or MCP-registry entry publishes no skill package, and any other host is outside the community allowlist.`,
    };
  }
  const { owner, repo } = upstream;

  try {
    const branch = await fetchDefaultBranch(ctx, owner, repo);
    const { entries, truncated, sha } = await fetchTree(ctx, owner, repo, branch);
    if (truncated) {
      return {
        ok: false,
        reason: 'tree-truncated',
        message: `GitHub truncated its listing of "${owner}/${repo}" at ${branch} — forge will not vendor a package it could not enumerate in full.`,
      };
    }

    const roots = candidateRoots(id);
    const foundRoot = roots.find((candidate) => entries.some((e) => e.path === candidate));
    if (foundRoot === undefined) {
      return {
        ok: false,
        reason: 'no-skill-package',
        message: `"${owner}/${repo}" publishes no SKILL.md at any path forge looks for (${roots.join(', ')}) — there is no package here to install.`,
      };
    }
    const prefix = foundRoot === 'SKILL.md' ? '' : foundRoot.slice(0, -'SKILL.md'.length);
    const inPackage = entries.filter((e) => e.path.startsWith(prefix));

    if (inPackage.length > MAX_PACKAGE_FILES) {
      return {
        ok: false,
        reason: 'too-many-files',
        message: `the package at "${owner}/${repo}${prefix === '' ? '' : `/${prefix}`}" declares ${inPackage.length} files, exceeding the ${MAX_PACKAGE_FILES}-file cap — refused before any file was downloaded.`,
      };
    }
    const declaredBytes = inPackage.reduce((sum, e) => sum + e.size, 0);
    if (declaredBytes > MAX_PACKAGE_BYTES) {
      return {
        ok: false,
        reason: 'too-many-bytes',
        message: `the package at "${owner}/${repo}${prefix === '' ? '' : `/${prefix}`}" declares ${declaredBytes} bytes, exceeding the ${MAX_PACKAGE_BYTES}-byte cap — refused before any file was downloaded.`,
      };
    }

    const files: PackageFile[] = [];
    const deadline = Date.now() + MAX_FETCH_WALL_MS;
    for (const entry of inPackage) {
      if (Date.now() > deadline) {
        throw new CommunityRefreshError(
          'timeout',
          `fetching the package from "${owner}/${repo}" passed ${MAX_FETCH_WALL_MS}ms after ${files.length} of ${inPackage.length} files — abandoned rather than held open.`,
        );
      }
      files.push({ path: entry.path.slice(prefix.length), body: await fetchBlob(ctx, owner, repo, entry) });
    }
    return {
      ok: true,
      package: { files: files.sort(packageOrder), ref: sha, resolvedUrl: `https://github.com/${owner}/${repo}` },
    };
  } catch (err) {
    if (err instanceof CommunityRefreshError) return { ok: false, reason: 'fetch-failed', kind: err.kind, message: err.message };
    throw err; // a genuine crash, not an expected failure — never laundered into a refusal
  }
}

// ---------------------------------------------------------------------------
// vendorFetchedPackage — the bytes reaching disk
// ---------------------------------------------------------------------------

export interface VendorPackageInput {
  forgeRoot: string;
  id: string;
  files: readonly PackageFile[];
}

/**
 * Write a fetched package into `studio/community/skills/<id>/`, from which the
 * EXISTING install pipeline picks it up unchanged.
 *
 * STAGE THEN RENAME, the discipline `runCommunityRefresh` and the registry
 * CRUD routes already use: every file is written into a sibling temp directory
 * and the whole package is renamed into place at the end. A refusal or a crash
 * part-way therefore leaves NOTHING at the destination — never a half-vendored
 * package that `routeCommunityInstall` would then treat as installable because
 * a SKILL.md happens to exist.
 *
 * NEVER OVERWRITES. An occupied destination throws rather than replacing what
 * is there: a vendored package is the subject of a trust decision (its
 * `contentHash` is what `skill-trust.ts` compares), so silently swapping its
 * bytes would invalidate an approval nobody was asked about.
 */
export function vendorFetchedPackage(input: VendorPackageInput): { dir: string } {
  const { forgeRoot, id, files } = input;
  const dir = vendoredPackageDir(forgeRoot, 'skill', id);
  if (existsSync(dir)) {
    throw new Error(`vendorFetchedPackage: "${id}" is already vendored at ${dir} — refusing to overwrite a package an approval may already cover`);
  }

  const staging = `${dir}.staging-${randomBytes(6).toString('hex')}`;
  const stagingBoundary = resolve(staging) + sep;
  try {
    mkdirSync(staging, { recursive: true });
    for (const file of files) {
      const abs = resolve(join(staging, file.path));
      if (!abs.startsWith(stagingBoundary)) {
        throw new Error(`vendorFetchedPackage: package file "${file.path}" escapes the package directory — refusing`);
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.body, 'utf8');
    }
    mkdirSync(dirname(dir), { recursive: true });
    renameSync(staging, dir);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  return { dir };
}
