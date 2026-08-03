/**
 * The install ledger — a central, git-tracked second source of truth for
 * installed-skill provenance (`studio/installed-skills.yaml`), extracted from
 * `skill-library.ts` to keep that module under its size cap (R3-01-F4).
 *
 * BLOCKER 2 (adversarial re-review of R3-01-F3/F4): the on-disk
 * `provenance.contentHash` pin lives INSIDE the very SKILL.md it protects —
 * an attacker (or an accidental edit) that rewrites the file's body can just
 * as easily delete or rewrite the pin alongside it, and `skillTrustState` saw
 * nothing wrong. This ledger is a SEPARATE file, written by the install
 * pipeline and read back by `skillTrustState`'s cross-check
 * (`orchestrator/studio/skill-library.ts`), recording what was actually
 * installed independent of what the installed file currently claims.
 *
 * HONESTY CONSTRAINT (binding, T2 design) — this is NOT tamper-proof. An
 * attacker (or script) with write access to BOTH this ledger and the skill's
 * SKILL.md, in the same change, can edit both consistently and defeat the
 * cross-check exactly as before. What this closes is the single-file blind
 * spot: editing ONE of the two without the other is now detected (a tampered
 * SKILL.md whose pin no longer agrees with the ledger, or a provenance block
 * that exists on disk with no corresponding registration). Nothing in this
 * module should ever be read, logged, or described as "integrity guaranteed"
 * or "tamper-proof" — it raises the cost and the detectability of tampering,
 * it does not eliminate it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { reqString, optString } from './yaml-fields.ts';
import { assertSkillSlug } from '../skill-path.ts';

export interface InstalledSkillLedgerEntry {
  id: string;
  source: string;
  upstreamRef?: string;
  contentHash: string;
  installedAt: string;
}

function ledgerPath(forgeRoot: string): string {
  return join(forgeRoot, 'studio', 'installed-skills.yaml');
}

/**
 * Parse the ledger's `installed:` array, enforcing its own 1:1 shape — the
 * ledger's whole job is to be an independently self-consistent second source
 * of truth, so it must not silently tolerate a malformed shape of its own:
 *
 *   - each entry's `id` must be a valid skill slug (never a traversal
 *     segment or an otherwise non-slug string) — validated on parse, not
 *     deferred to whatever later reads the ledger back;
 *   - two entries sharing an `id` (however their other fields differ) must
 *     throw naming the duplicate, never silently collapse last-one-wins when
 *     read back into a Map.
 */
function parseLedgerEntries(raw: unknown, file: string): InstalledSkillLedgerEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${file}: "installed" must be an array`);
  }
  const seenIds = new Set<string>();
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: installed[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    const id = reqString(e, 'id', file);
    try {
      assertSkillSlug(id);
    } catch (err) {
      throw new Error(`${file}: installed[${i}] has an invalid id — ${(err as Error).message}`);
    }
    if (seenIds.has(id)) {
      throw new Error(
        `${file}: duplicate installed-skill id "${id}" — the ledger must have exactly one entry per id`,
      );
    }
    seenIds.add(id);
    return {
      id,
      source: reqString(e, 'source', file),
      upstreamRef: optString(e, 'upstreamRef'),
      contentHash: reqString(e, 'contentHash', file),
      installedAt: reqString(e, 'installedAt', file),
    };
  });
}

/**
 * Read the ledger as a Map keyed by skill id.
 *
 * An ABSENT file is a normal fresh-checkout state — nothing has ever been
 * installed through the pipeline yet — and returns an empty map. A file that
 * EXISTS but fails to parse (malformed YAML, wrong root shape, a malformed
 * entry) FAILS LOUD: it must never be silently treated as "no ledger", which
 * would re-open Blocker 2 by a different door (a tampered file paired with a
 * corrupted-on-purpose ledger would otherwise read back as "unregistered",
 * not as the loud failure it actually is).
 */
export function readInstallLedger(forgeRoot: string): Map<string, InstalledSkillLedgerEntry> {
  const file = ledgerPath(forgeRoot);
  if (!existsSync(file)) return new Map();

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`${file}: cannot read install ledger — ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`${file}: install ledger YAML parse error — ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file}: install ledger YAML root must be a mapping`);
  }

  const entries = parseLedgerEntries((parsed as Record<string, unknown>)['installed'], file);
  return new Map(entries.map((e) => [e.id, e]));
}

/**
 * Upsert one entry and rewrite the whole ledger, sorted by id for a
 * deterministic git diff. Used by `installSkillPackage` (new entry) and
 * `repinSkillPackage` (contentHash update on an existing entry).
 */
export function writeInstallLedgerEntry(forgeRoot: string, entry: InstalledSkillLedgerEntry): void {
  const ledger = readInstallLedger(forgeRoot);
  ledger.set(entry.id, entry);
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  const installed = [...ledger.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(ledgerPath(forgeRoot), yaml.dump({ installed }), 'utf8');
}
