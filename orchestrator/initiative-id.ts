/**
 * Dual-ID resolver for initiative IDs (S1.1 — plan 07b).
 *
 * Canonical IDs (`INIT-YYYY-MM-DD-<project>-<slug>`) are unchanged and
 * remain authoritative everywhere on disk (queue filenames, branches,
 * worktrees, log dirs, manifest YAML). This module adds a parallel
 * **handle** index (`<proj4>#<seq>`, e.g. `traf#7`) — a typing-friendly
 * lookup layer the operator uses in slash commands and CLI calls.
 *
 * Contracts honoured:
 *  - C16b spirit — corrupt registry treated as empty, the backfill or
 *          next mint regenerates it idempotently.
 *
 * Single source of truth for resolution: `resolveInitiativeId(input)`.
 * Every CLI command that takes `<initiative-id>` routes through it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AliasRegistry = {
  version: 1;
  /** handle (e.g. `traf#7`) → canonical id */
  by_handle: Record<string, string>;
  /** canonical id → { handle, name? } */
  by_canonical: Record<string, { handle: string; name?: string | null }>;
  /** name alias → canonical id */
  by_name: Record<string, string>;
  /** project name (lowercased, slugified) → minted 4-char prefix */
  by_project: Record<string, string>;
  /** prefix → highest sequence number minted under that prefix */
  counters: Record<string, number>;
};

export type ResolveResult =
  | { kind: 'ok'; canonical: string; handle: string; name?: string | null }
  | { kind: 'ambiguous'; matches: string[] }
  | { kind: 'not-found' };

export type RegistryOpts = {
  /** Path to the `_queue/` directory housing `_aliases.json`. Defaults to
   *  `<forge-root>/_queue` resolved from the CWD (the CLI chdir's to forge
   *  root so this is correct in production). */
  queueRoot?: string;
};

// ---------------------------------------------------------------------------
// Constants / regexes
// ---------------------------------------------------------------------------

/** Canonical id pattern for initiative IDs. */
const CANONICAL_PATTERN = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
/** Handle format `<proj4>#<seq>`. */
const HANDLE_PATTERN = /^[a-z0-9]{3,5}#\d+$/;

const REGISTRY_FILE = '_aliases.json';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function registryPath(queueRoot?: string): string {
  const root = queueRoot ?? resolve('_queue');
  return join(root, REGISTRY_FILE);
}

// ---------------------------------------------------------------------------
// Loading + persistence
// ---------------------------------------------------------------------------

function emptyRegistry(): AliasRegistry {
  return {
    version: 1,
    by_handle: {},
    by_canonical: {},
    by_name: {},
    by_project: {},
    counters: {},
  };
}

/**
 * Read the registry from disk. Unlocked per C17 (writers serialise; readers
 * see whatever atomic snapshot is on disk). Missing or corrupt files are
 * treated as an empty registry (C16b spirit — idempotent replay over silent
 * skip; the next mint regenerates everything from canonical IDs).
 */
export function loadAliases(opts: RegistryOpts = {}): AliasRegistry {
  const path = registryPath(opts.queueRoot);
  if (!existsSync(path)) return emptyRegistry();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AliasRegistry>;
    // Light shape coercion so a partial/legacy file still works.
    return {
      version: 1,
      by_handle: parsed.by_handle ?? {},
      by_canonical: parsed.by_canonical ?? {},
      by_name: parsed.by_name ?? {},
      by_project: parsed.by_project ?? {},
      counters: parsed.counters ?? {},
    };
  } catch (err) {
    // Corrupt JSON — treat as empty so the next mint re-derives everything.
    // We log to stderr so the operator notices (per C16b spirit).
    process.stderr.write(
      `[initiative-id] warning: ${path} unparseable (${err instanceof Error ? err.message : String(err)}); treating as empty registry\n`,
    );
    return emptyRegistry();
  }
}

// ---------------------------------------------------------------------------
// resolveInitiativeId — the only reader the CLI should use
// ---------------------------------------------------------------------------

/**
 * Map any operator-typed input to a canonical id.
 *
 * Accepts (in order of precedence):
 *  1. Canonical id (returned as-is; handle filled in from registry if known)
 *  2. Handle `proj#N` (via `by_handle`)
 *  3. Named alias (via `by_name`)
 *  4. Globally-unique canonical substring (e.g. `slugify-batch` resolves
 *     when exactly one canonical contains that token between the date and
 *     end). Multiple matches ⇒ `kind: 'ambiguous'`.
 *
 * The CLI wraps `kind: 'ambiguous'` into a stderr message + exit(2).
 */
export function resolveInitiativeId(
  input: string,
  opts: RegistryOpts = {},
): ResolveResult {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'not-found' };

  const reg = loadAliases(opts);

  // 1. Canonical exact match.
  if (CANONICAL_PATTERN.test(trimmed)) {
    const meta = reg.by_canonical[trimmed];
    return {
      kind: 'ok',
      canonical: trimmed,
      handle: meta?.handle ?? '',
      name: meta?.name ?? null,
    };
  }

  // 2. Handle exact match.
  if (HANDLE_PATTERN.test(trimmed) && reg.by_handle[trimmed]) {
    const canonical = reg.by_handle[trimmed];
    const meta = reg.by_canonical[canonical];
    return {
      kind: 'ok',
      canonical,
      handle: trimmed,
      name: meta?.name ?? null,
    };
  }

  // 3. Named alias.
  if (reg.by_name[trimmed]) {
    const canonical = reg.by_name[trimmed];
    const meta = reg.by_canonical[canonical];
    return {
      kind: 'ok',
      canonical,
      handle: meta?.handle ?? '',
      name: trimmed,
    };
  }

  // 4. Substring search over known canonicals (case-insensitive). This is
  //    the "talk about it by a piece of the slug" fallback the plan mentions.
  const needle = trimmed.toLowerCase();
  const matches = Object.keys(reg.by_canonical).filter((c) =>
    c.toLowerCase().includes(needle),
  );
  if (matches.length === 1) {
    const canonical = matches[0];
    const meta = reg.by_canonical[canonical];
    return {
      kind: 'ok',
      canonical,
      handle: meta?.handle ?? '',
      name: meta?.name ?? null,
    };
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', matches };
  }

  return { kind: 'not-found' };
}
