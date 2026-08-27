/**
 * Hook PACKAGE primitives — read, hash, and classify the on-disk files that
 * make up a `studio/hooks/<id>/` package (fix for the sibling-file blind
 * spot found in a 2026-08-28 hostile review — PIN A/B/C in
 * hook-scan.test.ts, PIN D in hook-runtime.test.ts).
 *
 * WHY THIS MODULE EXISTS: a hook is a package DIRECTORY — `hook.yaml` plus
 * whatever script(s) it needs — not a single file.
 * `community-install.ts`'s `installCommunityHookPackage` already enforces
 * `MAX_PACKAGE_FILES`/`MAX_PACKAGE_BYTES` precisely BECAUSE more than one
 * file is an expected, supported shape (a `hook.yaml`'s declared `script:`
 * can legitimately `source`/`.` a sibling, e.g. `scripts/lib.sh` — an
 * ordinary bash idiom, not a hypothetical). Before this module existed, both
 * the approval ledger (`HookApprovalLedgerEntry.scriptHash`, in
 * `hook-scan.ts`) and the pre-approval scan (`scanHookPackage`) looked at
 * exactly ONE file — the single script named by `hook.yaml`'s `script:`
 * field — and never at anything else living in the directory. An attacker
 * (or a compromised registry, or a careless later edit) who left that one
 * entry script byte-for-byte untouched and only edited a sourced sibling
 * changed exactly what runs while every hash the ledger checked, and
 * everything the scanner read, stayed byte-identical: the hook kept reading
 * as approved, reviewed, and clean, and `runHookScript` spawned the
 * attacker's bytes under a stale approval.
 *
 * This module is the shared, single read/hash/classify primitive both
 * `hook-scan.ts` (the ledger + the scan) and
 * `cli/bridge-studio-community.ts` (the pre-install preview) now build on,
 * so neither surface can independently regress back to a single-file view —
 * one predicate, one meaning, per the standing lesson that a defense-in-depth
 * check must mirror the thing it backstops.
 *
 * Deliberately MIRRORS `skill-library.ts`'s `readSkillPackage`/
 * `hashSkillPackage` pair (the sibling SKILL pipeline already got this
 * right) rather than inventing a second hashing scheme — see the two
 * documented, deliberate differences on `hashHookPackage` below.
 *
 * WHAT THIS MODULE PROVABLY DOES NOT COVER (read together with
 * `hook-scan.ts`'s own HONEST LIMIT section — everything stated there still
 * applies one layer down):
 *   - it assigns no trust and computes no verdict. `readHookPackage`/
 *     `hashHookPackage`/`selectScannableHookFiles` are pure read/hash/select
 *     primitives; `hook-scan.ts` is the one place that decides what a
 *     package's bytes MEAN (`blocked`/`findings`/`clean`) and whether an
 *     existing approval still covers them;
 *   - `selectScannableHookFiles`'s fixpoint basename-mention match is a
 *     deliberate OVER-approximation of shell `source`/`.` — it can select a
 *     file that is never actually sourced (an extra, harmless scan) but
 *     cannot see a sourced file whose basename never literally appears in an
 *     already-selected file's body (e.g. a path built entirely from shell
 *     variables at runtime) — the same "static scanner, not an interpreter"
 *     limit `hook-scan.ts`'s header already states, one level up;
 *   - `readHookPackage` enforces `MAX_PACKAGE_FILES`/`MAX_PACKAGE_BYTES`
 *     only against what it is about to READ. Enforcing those caps against a
 *     WRITE is `installCommunityHookPackage`'s job on the install path —
 *     this module re-checks them on read only so a package that somehow
 *     exceeds them after installation fails loud instead of silently
 *     truncating.
 *
 * `hashHookScript`/`hashHookPermissions`/`hashHookTrigger` were MOVED here
 * verbatim (cut, not copied — doc comments intact) from `hook-scan.ts`,
 * which was re-approaching this repo's 800-line hard file-size max;
 * `hook-scan.ts` re-exports all three so no existing importer changes. They
 * stay logically part of the "hash a piece of a hook" family this module now
 * owns, even though — unlike the two whole-package functions above — each
 * hashes a single script/manifest/trigger rather than every file in the
 * package.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, extname, join } from 'node:path';
import yaml from 'js-yaml';

import { hookDir, hooksDir } from './hook-library.ts';
import type { HookPermissionManifest } from './hook-library.ts';
import { guardedFile } from '../../cli/studio-path-guard.ts';
import { EXECUTABLE_EXTENSIONS, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES } from './skill-library.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HookPackageFile {
  /** Relative, POSIX-separated path from the hook's own directory. */
  path: string;
  body: string;
  /** True iff the leaf's mode carries any of the owner/group/other execute
   *  bits (`st.mode & 0o111`). */
  executable: boolean;
}

// ---------------------------------------------------------------------------
// readHookPackage — walk the WHOLE package, leaf-guarded, capped, sorted.
// Mirrors community-index.ts's readVendoredPackage (the exact
// walk-and-guard-every-leaf pattern) and skill-library.ts's readSkillPackage
// (the SKILL.md/hook.yaml-first sort).
// ---------------------------------------------------------------------------

/** Normalize a `hook.yaml` `script:` (or any package-relative) path — split
 *  on `/`, drop empty and `.` segments, rejoin. A `hook.yaml` may
 *  legitimately spell `script: scripts//run.sh`; `path.resolve` tolerates
 *  that everywhere else in this codebase, so a literal string comparison
 *  here would make a valid hook's entry file unmatchable. Exported so every
 *  caller matching a package file against a declared entry path
 *  (`selectScannableHookFiles` below, and `hook-scan.ts`'s own entry-file
 *  lookups) shares this ONE normalization rather than each retyping a
 *  possibly-drifting copy. */
export function normalizeHookEntryPath(path: string): string {
  return path
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/');
}

export function readHookPackage(forgeRoot: string, id: string): HookPackageFile[] {
  const dir = hookDir(id, forgeRoot); // slug-asserts before any path is built
  if (!existsSync(join(dir, 'hook.yaml'))) {
    throw new Error(`readHookPackage: no hook.yaml found for hook "${id}" under "${dir}"`);
  }
  const base = hooksDir(forgeRoot);

  type RawEntry = { relPath: string; realPath: string };
  const rawEntries: RawEntry[] = [];

  const walk = (absDir: string, relDir: string): void => {
    let dirents: Dirent[];
    try {
      dirents = readdirSync(absDir, { withFileTypes: true });
    } catch (e) {
      throw new Error(`readHookPackage: cannot read hook package directory "${absDir}" for hook "${id}" — ${(e as Error).message}`);
    }
    for (const entry of dirents) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(absDir, entry.name), relPath);
        continue;
      }
      if (!entry.isFile()) {
        // A symlink dirent, socket, fifo, device node, or anything else that
        // is neither a regular file nor a directory. Silently SKIPPING this
        // would be an escape, not a convenience: an added-but-unhashed
        // symlink can point anywhere on disk, so both hashHookPackage's
        // fingerprint and selectScannableHookFiles' scan-file selection would
        // simply never see it — a hole, not an omission. This fails closed
        // instead. One bad package can never take the whole library down
        // because of this: every production caller that lists many hooks at
        // once (cli/bridge-studio-hooks.ts's `toClientListEntry`) already
        // wraps its per-hook read in a try/catch, so this throw surfaces as a
        // per-item error field, never a 500 for the other N-1 hooks.
        throw new Error(
          `readHookPackage: entry "${relPath}" of hook "${id}" is neither a regular file nor a directory (a symlink, socket, or similar) — refusing to read the package`,
        );
      }
      const realPath = guardedFile(base, [id, ...relPath.split('/')], 'read');
      if (realPath === null) {
        throw new Error(
          `readHookPackage: leaf "${relPath}" of hook "${id}" is missing or fails realpath containment (a symlinked/hardlinked leaf never surfaces its bytes) — refusing to read`,
        );
      }
      rawEntries.push({ relPath, realPath });
    }
  };
  walk(dir, '');

  if (rawEntries.length > MAX_PACKAGE_FILES) {
    throw new Error(`readHookPackage: hook "${id}" has ${rawEntries.length} files, exceeding the ${MAX_PACKAGE_FILES}-file cap`);
  }

  // STAT BEFORE READ (2026-08-28 adversarial review, reproduced): the byte cap
  // used to be accumulated from `Buffer.byteLength(body)` AFTER `readFileSync`
  // had already pulled the whole file into memory — a single 200 MiB script in
  // a 5 MiB-capped package cost 207 MiB of RSS to reject, and
  // `POST /api/studio/hooks` writes a client-supplied `scriptBody` with no size
  // check of its own, so that file is wire-reachable. `st.size` is the on-disk
  // byte length, i.e. exactly what the cap is denominated in, so checking it
  // first refuses the same packages without ever allocating their bytes. The
  // stat was already being taken for the mode bit; this only moves it ahead of
  // the read.
  const files: HookPackageFile[] = [];
  let totalBytes = 0;
  for (const { relPath, realPath } of rawEntries) {
    const st = statSync(realPath);
    totalBytes += st.size;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`readHookPackage: hook "${id}" exceeds the ${MAX_PACKAGE_BYTES}-byte cap`);
    }
    files.push({ path: relPath, body: readFileSync(realPath, 'utf8'), executable: (st.mode & 0o111) !== 0 });
  }

  files.sort((a, b) => {
    if (a.path === 'hook.yaml') return -1;
    if (b.path === 'hook.yaml') return 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return files;
}

// ---------------------------------------------------------------------------
// hashHookPackage — the whole-package fingerprint.
// ---------------------------------------------------------------------------

/**
 * Deterministic, order-independent content hash over an ENTIRE hook package
 * (every file `readHookPackage` returned) — the approval ledger's fourth pin
 * (`HookApprovalLedgerEntry.packageHash`, in `hook-scan.ts`), closing the
 * sibling-file blind spot the three per-half hashes (script/permissions/
 * trigger) structurally cannot: none of them ever look at a file besides the
 * one declared entry script.
 *
 * The hash input is LENGTH-PREFIXED for both the path and the body of every
 * file (`"<byteLength>:" + the bytes themselves`, back to back, sorted by
 * path first) so no path/body — or file/file — boundary is ever ambiguous. A
 * bare concatenation could hash `path:"a", body:"bc"` identically to
 * `path:"ab", body:"c"`; length-prefixing every field makes that collision
 * structurally impossible.
 *
 * Two DELIBERATE differences from `hashSkillPackage` (skill-library.ts),
 * spelled out rather than left for a reader to wonder about:
 *
 *   1. the EXECUTABLE BIT is part of the hash input. `chmod +x` on an
 *      existing file changes what a package can DO — a `#!/usr/bin/env bash`
 *      script is only directly runnable via its own `+x` bit, and
 *      `selectScannableHookFiles` below itself treats `executable` as one of
 *      its scan triggers — without changing a single byte of content. A hash
 *      that ignored the mode bit would let exactly that change slip past the
 *      fingerprint.
 *   2. there is NO frontmatter-canonicalization exclusion list.
 *      `hashSkillPackage` excludes `status`/`library`/`provenance` from
 *      SKILL.md because a skill's OWN trust bookkeeping is written INSIDE
 *      the very file being hashed — self-referential, so the hash would
 *      otherwise depend on its own stored value. A hook stores no such
 *      bookkeeping in `hook.yaml` at all: its approval lives entirely in the
 *      separate `studio/hook-approvals.yaml` ledger, so every byte of every
 *      file — `hook.yaml` included — is legitimate hash input with nothing
 *      to exclude.
 */
export function hashHookPackage(files: readonly HookPackageFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const f of sorted) {
    const pathBuf = Buffer.from(f.path, 'utf8');
    hash.update(`${pathBuf.length}:`, 'utf8');
    hash.update(pathBuf);
    hash.update(f.executable ? 'x:1:1' : 'x:1:0', 'utf8'); // difference #1 — see above
    const bodyBuf = Buffer.from(f.body, 'utf8');
    hash.update(`${bodyBuf.length}:`, 'utf8');
    hash.update(bodyBuf);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Recursively sort every object's keys so a canonical form depends on VALUES,
 *  never on the order a YAML author happened to write the keys in. Arrays keep
 *  their order (element order is meaningful almost everywhere; the two grant
 *  lists that legitimately are not are sorted explicitly by the caller below). */
function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeysDeep);
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortObjectKeysDeep(o[k])]));
  }
  return value;
}

/**
 * `hook.yaml`'s body for HASHING purposes only, canonicalized the same way
 * `hashHookPermissions`/`hashHookTrigger` already canonicalize their own
 * inputs (env/read SORTED) — so a pure reordering of an already-granted
 * permissions list does not, by itself, change `hashHookPackage`'s output and
 * spuriously force re-review. This does NOT contradict difference #2 above
 * (`hashHookPackage` itself still excludes nothing and canonicalizes
 * nothing — it stays a dumb byte-hasher): this is a helper for the ONE caller
 * (hook-scan.ts's `snapshotHookPackage`) that needs canonical bytes for the one
 * file whose trust surface is already independently, canonically pinned by the
 * other three named hashes.
 *
 * DERIVED FROM THE RAW BYTES, NOT FROM `HookDefinition` (2026-08-28 adversarial
 * review, flagged as a latent drift trap): the first cut built this projection
 * out of the parsed definition's six known fields, so ANY other key in
 * `hook.yaml` — including one added to `HookDefinition` later and consumed at
 * runtime but forgotten here — sat outside the package fingerprint. That is the
 * `declared-data-fails-open` shape one level down, and the cure is the same as
 * everywhere else: derive from the source of truth. Parsing the real document
 * and canonicalizing only what is genuinely cosmetic (key order, and the two
 * grant lists whose order carries no meaning) covers every key, known or not,
 * and cannot drift as the definition grows. Comments and whitespace are dropped
 * by the parse, which is correct: neither changes what the hook does.
 */
export function canonicalHookYamlBody(rawBody: string): string {
  const parsed: unknown = yaml.load(rawBody);
  // Not a mapping — `loadHookDefinition` rejects that shape upstream, so this is
  // unreachable through any real caller. Fall back to the RAW bytes rather than
  // canonicalizing nothing: a fingerprint that quietly ignored a file it could
  // not parse would be the fail-open shape this whole module exists to close.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return rawBody;

  const doc: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  const permissions = doc['permissions'];
  if (permissions !== null && typeof permissions === 'object' && !Array.isArray(permissions)) {
    const p: Record<string, unknown> = { ...(permissions as Record<string, unknown>) };
    for (const key of ['env', 'read']) {
      const list = p[key];
      if (Array.isArray(list) && list.every((x) => typeof x === 'string')) {
        p[key] = [...(list as string[])].sort((a, b) => a.localeCompare(b));
      }
    }
    doc['permissions'] = p;
  }
  return JSON.stringify(sortObjectKeysDeep(doc));
}

// ---------------------------------------------------------------------------
// selectScannableHookFiles — "every file that can execute or be sourced"
// ---------------------------------------------------------------------------

/** Extensions from `EXECUTABLE_EXTENSIONS` (skill-library.ts) plus `.ts` —
 *  DERIVED, never a retyped copy, so the two lists cannot drift. `.ts` is
 *  added because a hook script can be a `node --experimental-strip-types`
 *  TypeScript file, a shape `EXECUTABLE_EXTENSIONS` (built for the SKILL
 *  package pipeline) has no reason to know about. */
export const HOOK_SOURCEABLE_EXTENSIONS: readonly string[] = [...EXECUTABLE_EXTENSIONS, '.ts'];

/**
 * Every file in `files` that can execute or be sourced when the declared
 * ENTRY script (`entryPath`) runs — the file set `hook-scan.ts`'s
 * `scanHookFiles`/`scanHookPackage` scans and `hashHookPackage` fingerprints,
 * i.e. "every file whose bytes matter to what this hook actually does at
 * spawn time".
 *
 * Selected:
 *   - the entry file itself, ALWAYS, and placed FIRST in the returned order
 *     — load-bearing: `hook-scan.ts`'s `scanHookFiles` dedupes `env-read`
 *     findings by variable name, first occurrence wins, so scanning the
 *     entry script first is what makes a deduped finding attribute to it;
 *   - any file whose extension is in `HOOK_SOURCEABLE_EXTENSIONS` (a script
 *     the entry could plausibly `source`/`.` or invoke by interpreter,
 *     whether or not it is ever actually mentioned by name);
 *   - any file with its executable bit set (can run on its own regardless of
 *     extension);
 *   - then, iterated to a FIXPOINT: if an already-selected file's body
 *     contains another package file's basename as a substring, that file is
 *     selected too. This is a deliberate OVER-approximation of shell
 *     `source`/`.` directives (it catches
 *     `. "$(dirname "$0")/lib.sh"` without parsing shell at all) — it can
 *     select a file that turns out never to be genuinely sourced, which
 *     costs one extra, harmless scan. Over-flagging is this module's stated
 *     posture, not an oversight: `hook-scan.ts`'s own header already argues
 *     the identical trade for the `AZDO_*`/`GH_*` env-prefix rule — a false
 *     positive costs one manifest declaration or one extra scanned file; a
 *     false negative on genuinely sourced code is the exact hole PIN B
 *     exists to close.
 *
 * `entryPath` is normalized via `normalizeHookEntryPath` before matching, so
 * a `hook.yaml` spelling `script: scripts//run.sh` still matches the file at
 * `scripts/run.sh` in `files`.
 *
 * A pure selection function — it never throws for a missing entry file (that
 * is a validation concern for the caller, e.g. `hook-scan.ts`'s
 * `scanHookFiles`, which must not silently "scan nothing and report clean").
 */
export function selectScannableHookFiles(
  files: readonly HookPackageFile[],
  entryPath: string,
): HookPackageFile[] {
  const normalizedEntry = normalizeHookEntryPath(entryPath);
  const entryFile = files.find((f) => normalizeHookEntryPath(f.path) === normalizedEntry);

  const selected = new Map<string, HookPackageFile>();
  if (entryFile) selected.set(entryFile.path, entryFile);

  for (const f of files) {
    if (selected.has(f.path)) continue;
    const ext = extname(f.path);
    if (HOOK_SOURCEABLE_EXTENSIONS.includes(ext) || f.executable) {
      selected.set(f.path, f);
    }
  }

  // WORKLIST, NOT A RE-SCANNING FIXPOINT (2026-08-28 adversarial review,
  // reproduced): the first cut re-scanned EVERY selected body against EVERY
  // unselected basename on EVERY round. A package of 482 chained files — 4.3 MB,
  // comfortably inside both MAX_PACKAGE_FILES and MAX_PACKAGE_BYTES, so it
  // installs cleanly through the gated community pipeline — took 1,885 ms of
  // synchronous CPU. `hookRunState` re-derives from scratch on every call and is
  // called once per hook inside the hooks-list route's `.map()`, so ONE such
  // package added ~1.9 s of event-loop block to every `GET /api/studio/hooks`.
  //
  // Each body is now tokenized exactly ONCE and looked up in a basename index,
  // making the whole closure linear in the package's total bytes (the same
  // 482-file package now costs single-digit milliseconds). The token class below
  // deliberately excludes `/`, quotes, whitespace, `$`, `(` and `)` — every
  // separator a `source`/`.` directive spells its target with — so
  // `. "$(dirname "$0")/lib.sh"` still yields the token `lib.sh`.
  //
  // This is also strictly MORE precise than the old `body.includes(base)`: a
  // basename embedded inside a longer token (`lib.sh` inside `mylib.sh`) no
  // longer selects, which was a false positive rather than a real `source`. The
  // trust decision does not depend on this predicate either way —
  // `hashHookPackage` fingerprints every file `readHookPackage` returns,
  // unfiltered by this selection — so a selector miss costs a scan finding, never
  // a stale approval.
  const isSpellableToken = (s: string): boolean => /^[A-Za-z0-9._+-]+$/.test(s);
  const byBasename = new Map<string, HookPackageFile[]>();
  const oddNamed: HookPackageFile[] = [];
  for (const f of files) {
    const base = basename(f.path);
    if (isSpellableToken(base)) {
      const bucket = byBasename.get(base);
      if (bucket) bucket.push(f);
      else byBasename.set(base, [f]);
    } else {
      // A basename carrying a character the token class cannot spell (a space,
      // say). Rare, but it must not silently drop out of the closure, so those
      // few files keep the original substring test.
      oddNamed.push(f);
    }
  }

  const queue = [...selected.values()];
  while (queue.length > 0) {
    const from = queue.shift()!;
    for (const token of from.body.match(/[A-Za-z0-9._+-]+/g) ?? []) {
      for (const candidate of byBasename.get(token) ?? []) {
        if (selected.has(candidate.path)) continue;
        selected.set(candidate.path, candidate);
        queue.push(candidate);
      }
    }
    for (const candidate of oddNamed) {
      if (selected.has(candidate.path)) continue;
      if (from.body.includes(basename(candidate.path))) {
        selected.set(candidate.path, candidate);
        queue.push(candidate);
      }
    }
  }

  const rest = [...selected.values()]
    .filter((f) => f.path !== entryFile?.path)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entryFile ? [entryFile, ...rest] : rest;
}

// ---------------------------------------------------------------------------
// hashHookScript / hashHookPermissions / hashHookTrigger — MOVED verbatim
// from hook-scan.ts (which re-exports all three so no importer changes) to
// keep that module under this repo's 800-line hard file-size max. Doc
// comments unchanged from their original location. Deterministic content
// pins for the approval ledger, deliberately SEPARATE from each other and
// from `hashHookPackage` above (see `HookApprovalLedgerEntry`'s own doc
// comment in hook-scan.ts): a mismatch on one must never be mistaken for
// another.
// ---------------------------------------------------------------------------

export function hashHookScript(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

/**
 * Pure, content-addressed hash over a hook's PERMISSION MANIFEST — the
 * approval ledger's second pin (JOB B). Canonicalized before hashing:
 * `env`/`read` are SORTED so a pure reordering of an already-granted list
 * (no actual change to the grant set) does not spuriously demand
 * re-approval, while any REAL change — a var added/removed, `network`
 * flipped either direction, tightening as much as widening — produces a
 * different hash and correctly forces review.
 */
export function hashHookPermissions(permissions: HookPermissionManifest): string {
  const canonical = {
    env: [...permissions.env].sort((a, b) => a.localeCompare(b)),
    read: [...permissions.read].sort((a, b) => a.localeCompare(b)),
    network: permissions.network,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')}`;
}

/**
 * Pure, content-addressed hash over a hook's TRIGGER CONDITION (`on` +
 * `matcher`) — the approval ledger's third pin (D-M). A hook moved from
 * `SessionEnd` to `PreToolUse` grants no new capability but fires far more
 * often; an operator's approval was for a specific exposure, not just a
 * specific script+grant, so a trigger-condition edit must re-enter review
 * exactly like a script or permissions edit does.
 */
export function hashHookTrigger(on: string, matcher: string | undefined): string {
  const canonical = { on, matcher: matcher ?? null };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')}`;
}
