/**
 * The hook APPROVAL LEDGER (`studio/hook-approvals.yaml`) and the trust state
 * derived from it — split out of `hook-scan.ts` in M4-library PR 4b, which was
 * 803 lines against the repo's 800-line hard cap.
 *
 * The seam is the one the file already had. `hook-scan.ts` is a pure, stateless
 * static scan: it touches no filesystem, and every one of its module-level
 * pattern constants is read by exactly one scan function. Everything here is
 * the opposite — it reads and writes a git-tracked yaml file and decides
 * whether a hook may run. All four of the module's request-path fs sink kinds
 * (`existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync` — each now a
 * SINGLE call site behind the shared `readHookLedgerDoc`/`writeHookLedgerDoc`,
 * bead forge-8vfn.5.2's `declined`-state refactor) lived in this half, which
 * is the corroborating evidence that the I/O boundary was already there and
 * this split only names it.
 *
 * The dependency is one-directional — this module imports `scanHookFiles` from
 * `hook-scan.ts` (via `snapshotHookPackage`), and nothing in `hook-scan.ts`
 * reaches back. No shared mutable state crosses: `hook-scan.ts` has no `let`,
 * no cache and no load-time side effect at all.
 *
 * HONESTY CONSTRAINT, carried verbatim from the original and still true: this
 * ledger is NOT tamper-proof. An attacker who edits both the script and this
 * file in the same change defeats it exactly as before. It detects an EDIT that
 * changes the script bytes without also re-recording approval — no more.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { assertSkillSlug } from '@forge/kernel/ids.ts';
import { reqString, optString } from '@forge/kernel/studio/yaml-fields.ts';
import { loadHookDefinition } from './hook-library.ts';
import {
  readHookPackage,
  hashHookPackage,
  canonicalHookYamlBody,
  hashHookScript,
  hashHookPermissions,
  hashHookTrigger,
  normalizeHookEntryPath,
} from './hook-package.ts';
import { scanHookFiles, type HookScanReport, type HookScanVerdict } from './hook-scan.ts';

/**
 * 2026-08-04 JOB B (second post-migration adversarial review): a pin that
 * covers only HALF of what it protects is not a pin. An approval means "this
 * exact script WITH these exact declared permissions" — `permissions.env`/
 * `read`/`network` live in `hook.yaml`, a separate file from the script, so
 * pinning `scriptHash` alone let an operator (or attacker) widen a hook's
 * granted permissions after approval without ever touching the script bytes,
 * and the ledger would keep reporting the hook needed no re-review. TWO
 * separate named hashes — never one concatenated blob, never a whole-package
 * hash covering `name`/`description`/`matcher`/`on` too — so a mismatch
 * unambiguously tells an operator/log WHICH half changed.
 *
 * MINOR (2026-08-04, third adversarial review, D-M): `on`/`matcher` were
 * never part of the approval hash either — an approved hook could be moved
 * from `SessionEnd` (fires once) to `PreToolUse` (fires on every tool call)
 * with the script and permissions untouched, granting no new CAPABILITY but
 * materially changing EXPOSURE, and `needsReview` stayed false. THIRD named
 * hash, `triggerHash` — same "which half changed" legibility argument as
 * `scriptHash`/`permissionsHash`, not folded into either.
 *
 * AMENDED 2026-08-28 (hostile review — PIN A/B/C, hook-scan.test.ts; PIN D,
 * hook-runtime.test.ts): the reasoning above never contemplated CODE FILES
 * beside the entry script — together the three hashes only look at ONE file,
 * so a sourced sibling could be edited post-approval with all three
 * identical. FOURTH pin added: `packageHash` (`hashHookPackage`) — a
 * whole-package fingerprint, strictly subsuming the other three (kept for
 * "which half changed" legibility). OPTIONAL on the type (a legacy entry has
 * no such key), but `hookRunState` treats its absence as needing review,
 * never trusted (PIN C, load-bearing).
 */
export interface HookApprovalLedgerEntry {
  id: string;
  scriptHash: string;
  permissionsHash: string;
  triggerHash: string;
  /** Whole-package fingerprint (amendment above). Absent-on-legacy ⇒ needsReview (PIN C), never trusted. */
  packageHash?: string;
  overridden: boolean;
  reason?: string;
  approvedAt: string;
}

export interface HookRunState {
  verdict: HookScanVerdict;
  runnable: boolean;
  needsReview: boolean;
}

/**
 * bead forge-8vfn.5.2 — the THIRD ledger outcome, alongside `approved` and
 * `revoked`: an operator REVIEWED a hook and REJECTED it (the live example
 * the bead names is `pre-pr-security-review`). Without this a declined hook
 * sat at `needs-review` forever — indistinguishable from "nobody has looked
 * at this yet" — so the review queue never closed honestly.
 *
 * GRANTS NOTHING (say-so, load-bearing): `declineHook` never writes an
 * `approved` entry, so `hookRunState`'s `needsReview`/`runnable` computation
 * — which reads `approved` alone — is UNCHANGED by a decline. `declined` is a
 * label for DISPLAY (`computeTrust`, bridge-studio-hooks.ts), never a second
 * grant path the runtime authority has to know about.
 */
export interface HookDeclinedLedgerEntry {
  id: string;
  reason?: string;
  declinedAt: string;
}
// hashHookScript/hashHookPermissions/hashHookTrigger MOVED to hook-package.ts (see re-export above).
// ---------------------------------------------------------------------------
// The approval ledger (studio/hook-approvals.yaml) — a SECOND, git-tracked
// source of truth, mirroring skill-install-ledger.ts exactly. HONESTY
// CONSTRAINT (same as that module): NOT tamper-proof — an attacker who edits
// both the script and this ledger in the same change defeats it exactly as
// before. It only detects an EDIT that changes the script bytes without also
// re-recording approval.
// ---------------------------------------------------------------------------

function hookApprovalLedgerPath(forgeRoot: string): string {
  return join(forgeRoot, 'studio', 'hook-approvals.yaml');
}

/** Reads and YAML-parses the ledger file's raw mapping — shared by every
 *  per-list reader below so `approved`/`revoked`/`declined` fail exactly
 *  alike on a missing vs. a malformed file. Absent file ⇒ `null` (nothing
 *  recorded yet); a file that EXISTS but fails to read/parse/root-shape
 *  fails LOUD — never silently "no ledger". */
function readHookLedgerDoc(forgeRoot: string): Record<string, unknown> | null {
  const file = hookApprovalLedgerPath(forgeRoot);
  if (!existsSync(file)) return null;

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`${file}: cannot read hook approval ledger — ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`${file}: hook approval ledger YAML parse error — ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file}: hook approval ledger YAML root must be a mapping`);
  }
  return parsed as Record<string, unknown>;
}

function parseHookApprovalLedgerEntries(raw: unknown, file: string): HookApprovalLedgerEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${file}: "approved" must be an array`);
  }
  const seenIds = new Set<string>();
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: approved[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    const id = reqString(e, 'id', file);
    try {
      assertSkillSlug(id);
    } catch (err) {
      throw new Error(`${file}: approved[${i}] has an invalid id — ${(err as Error).message}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`${file}: duplicate approved-hook id "${id}" — the ledger must have exactly one entry per id`);
    }
    seenIds.add(id);
    return {
      id,
      scriptHash: reqString(e, 'scriptHash', file),
      permissionsHash: reqString(e, 'permissionsHash', file),
      triggerHash: reqString(e, 'triggerHash', file),
      // optString, not reqString: a legacy entry predating this field has no
      // "packageHash" key. hookRunState treats its absence as needing review
      // (PIN C), never as trusted — see HookApprovalLedgerEntry's doc comment.
      packageHash: optString(e, 'packageHash'),
      overridden: e['overridden'] === true,
      reason: optString(e, 'reason'),
      approvedAt: reqString(e, 'approvedAt', file),
    };
  });
}

/** Absent file ⇒ empty map (nothing has ever been approved). A file that
 *  EXISTS but fails to parse fails LOUD — never silently "no ledger". */
export function readHookApprovalLedger(forgeRoot: string): Map<string, HookApprovalLedgerEntry> {
  const entries = parseHookApprovalLedgerEntries(readHookLedgerDoc(forgeRoot)?.['approved'], hookApprovalLedgerPath(forgeRoot));
  return new Map(entries.map((e) => [e.id, e]));
}

/** The ledger's `revoked` list (W7-B4, library-08) — the RECORDED history of
 *  revocations. Read tolerantly for round-tripping only: `readHookApprovalLedger`
 *  (the runtime authority) never consults it, so a revoked entry can never be
 *  mistaken for a live approval. A missing file or absent list is `[]`; an
 *  unreadable/unparseable EXISTING file fails loud exactly like
 *  `readHookApprovalLedger` (same file, same contract). */
function readHookLedgerRevoked(forgeRoot: string): unknown[] {
  const revoked = readHookLedgerDoc(forgeRoot)?.['revoked'];
  return Array.isArray(revoked) ? revoked : [];
}

/** bead forge-8vfn.5.2 — the SAME strict validation discipline
 *  `parseHookApprovalLedgerEntries` uses: a malformed `declined[i]` throws,
 *  naming the file and the index — never a silent skip. Mirrors that
 *  function's shape (duplicate-id check included) rather than inventing a
 *  new one. */
function parseHookDeclinedLedgerEntries(raw: unknown, file: string): HookDeclinedLedgerEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${file}: "declined" must be an array`);
  }
  const seenIds = new Set<string>();
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: declined[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    const id = reqString(e, 'id', file);
    try {
      assertSkillSlug(id);
    } catch (err) {
      throw new Error(`${file}: declined[${i}] has an invalid id — ${(err as Error).message}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`${file}: duplicate declined-hook id "${id}" — the ledger must have exactly one entry per id`);
    }
    seenIds.add(id);
    return {
      id,
      reason: optString(e, 'reason'),
      declinedAt: reqString(e, 'declinedAt', file),
    };
  });
}

/** Absent file ⇒ empty map (nothing has ever been declined). A file that
 *  EXISTS but fails to parse fails LOUD, same discipline as
 *  `readHookApprovalLedger`. RUNTIME NOTE: `hookRunState` never consults
 *  this map — see `HookDeclinedLedgerEntry`'s doc comment; `declined` grants
 *  nothing, it is a review-outcome label for display only. */
export function readHookDeclinedLedger(forgeRoot: string): Map<string, HookDeclinedLedgerEntry> {
  const entries = parseHookDeclinedLedgerEntries(readHookLedgerDoc(forgeRoot)?.['declined'], hookApprovalLedgerPath(forgeRoot));
  return new Map(entries.map((e) => [e.id, e]));
}

/** One writer for the whole ledger document — `approved` (sorted) plus the
 *  carried-through `revoked` history and `declined` outcomes (sorted), so no
 *  code path can drop any one of the three while writing the others. */
function writeHookLedgerDoc(
  forgeRoot: string,
  approvedMap: Map<string, HookApprovalLedgerEntry>,
  revoked: unknown[],
  declinedMap: Map<string, HookDeclinedLedgerEntry>,
): void {
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  const approved = [...approvedMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const declined = [...declinedMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(
    hookApprovalLedgerPath(forgeRoot),
    yaml.dump({
      approved,
      ...(revoked.length > 0 ? { revoked } : {}),
      ...(declined.length > 0 ? { declined } : {}),
    }),
    'utf8',
  );
}

export function writeHookApprovalLedgerEntry(forgeRoot: string, entry: HookApprovalLedgerEntry): void {
  const ledger = readHookApprovalLedger(forgeRoot);
  const revoked = readHookLedgerRevoked(forgeRoot);
  const declined = readHookDeclinedLedger(forgeRoot);
  ledger.set(entry.id, entry);
  // A review outcome is exclusive — approving/overriding supersedes an
  // earlier decline for the same id (mirrors declineHook's own symmetric
  // clear in the other direction, below).
  declined.delete(entry.id);
  writeHookLedgerDoc(forgeRoot, ledger, revoked, declined);
}

/**
 * W7-B4 (library-08) — the INVERSE of {@link approveHook} that never existed:
 * remove the hook's live approval (so {@link hookRunState} honestly reads
 * needs-review / not-runnable again) and RECORD the revocation — the prior
 * entry's pinned hashes plus a `revokedAt` stamp appended to the ledger's
 * `revoked` list. An audit trail, never a silent erase.
 *
 * Error contract (ADR-042 pure-function boundary): throws when the hook has
 * no approval on record — a revocation of nothing is a caller state error the
 * bridge maps to 409, never a silent no-op.
 */
export function revokeHookApproval(input: { forgeRoot: string; id: string }): void {
  const { forgeRoot, id } = input;
  const ledger = readHookApprovalLedger(forgeRoot);
  const entry = ledger.get(id);
  if (!entry) {
    throw new Error(`revokeHookApproval: hook "${id}" has no approval on record — nothing to revoke`);
  }
  ledger.delete(id);
  const revoked = readHookLedgerRevoked(forgeRoot);
  revoked.push({ ...entry, revokedAt: new Date().toISOString() });
  writeHookLedgerDoc(forgeRoot, ledger, revoked, readHookDeclinedLedger(forgeRoot));
}

/**
 * bead forge-8vfn.5.2 — the THIRD review outcome, alongside approve/override:
 * "an operator looked at this hook and rejected it" (the live example:
 * `pre-pr-security-review`). Records a `declined` ledger entry so a reviewed-
 * and-rejected hook has something honest to be LABELLED besides
 * "needs-review forever" — but decline GRANTS NOTHING: it never writes an
 * `approved` entry, so `hookRunState`'s `needsReview`/`runnable` are exactly
 * what they were before this function ran. Declining supersedes any live
 * approval for the same id — the mirror image of `writeHookApprovalLedgerEntry`'s
 * own clear, so neither writer can leave both set.
 *
 * PRECISE CLAIM, corrected after the independent security review (finding 5):
 * the two cannot both be set THROUGH THESE WRITERS. A HAND-EDITED ledger can
 * still carry an id in both lists, and in that case `approved` silently wins —
 * `hookRunState` and `computeTrust` key off `approved`/`needsReview` alone and
 * never consult `declined`. That is the safe direction (it never widens
 * access) but it is not a contradiction the surface reports, so do not read
 * this comment as saying the state is impossible. It is impossible to reach
 * by writing; it is merely resolved, silently, by reading.
 */
export function declineHook(input: { forgeRoot: string; id: string; reason?: string }): void {
  const { forgeRoot, id, reason } = input;
  // Self-defending, like `approveHook`/`overrideHookBlock` — which validate via
  // `snapshotHookPackage → loadHookDefinition → assertSkillSlug` before they
  // write. The only caller today validates first (`handleHookDecline` goes
  // through `locateHook`), so this is unreachable now; that is exactly why it
  // belongs here. A future caller writing an invalid id would poison the whole
  // `declined` array, and `readHookDeclinedLedger` throws on the ARRAY, so one
  // bad entry degrades EVERY hook's list row and 500s the detail route.
  // Found by the independent security review of this change (finding 2).
  assertSkillSlug(id);
  const ledger = readHookApprovalLedger(forgeRoot);
  const revoked = readHookLedgerRevoked(forgeRoot);
  const declined = readHookDeclinedLedger(forgeRoot);
  ledger.delete(id);
  declined.set(id, { id, ...(reason ? { reason } : {}), declinedAt: new Date().toISOString() });
  writeHookLedgerDoc(forgeRoot, ledger, revoked, declined);
}

/**
 * W8-B4 (library-34) — tolerant companion to {@link revokeHookApproval} for a
 * caller that must succeed whether or not the hook was ever approved. Kept
 * SEPARATE from revokeHookApproval rather than changing that function's
 * contract: `POST /api/studio/hooks/:id/revoke-approval` is an explicit
 * operator ACT ("revoke this approval") where "nothing to revoke" is a real
 * state error the route deliberately maps to 409 (it already pre-checks
 * presence itself before calling through) — that contract is a deployed API
 * shape other callers may depend on, and loosening it here would blur an
 * explicit revoke request with a no-op into the same silent 200.
 *
 * DESTROYING a hook package is a different act: "this id no longer carries a
 * live approval" is true whether or not one ever existed, so the delete path
 * needs a call that is silent on the (common) no-op case. This is the ONE
 * function every hook-destroying call site should call before removing the
 * package directory — see packages/library/bridge-studio-hooks.ts's DELETE route, its
 * only production caller today.
 */
export function revokeHookApprovalIfPresent(input: { forgeRoot: string; id: string }): void {
  const { forgeRoot, id } = input;
  if (readHookApprovalLedger(forgeRoot).has(id)) {
    revokeHookApproval(input);
  }
}

// snapshotHookPackage — ONE disk read + ONE set of hashes shared by hookRunState/approveHook/overrideHookBlock.

interface HookPackageSnapshot {
  report: HookScanReport;
  ledgerCandidate: Pick<HookApprovalLedgerEntry, 'scriptHash' | 'permissionsHash' | 'triggerHash' | 'packageHash'>;
}

function snapshotHookPackage(forgeRoot: string, id: string): HookPackageSnapshot {
  const def = loadHookDefinition(id, forgeRoot);
  const files = readHookPackage(forgeRoot, id);
  const normalizedEntry = normalizeHookEntryPath(def.script);
  const entryFile = files.find((f) => normalizeHookEntryPath(f.path) === normalizedEntry);
  if (!entryFile) {
    throw new Error(
      `hook "${id}" declares script "${def.script}" but no such file exists in its package — refusing to scan or hash an absent entry`,
    );
  }
  // hook.yaml's body is canonicalized (key order + the two grant lists sorted)
  // before it enters the fingerprint, so a cosmetic reorder is not mistaken for
  // a real edit. Canonicalization runs on the file's OWN raw bytes, never on a
  // projection of the parsed definition — see canonicalHookYamlBody's own note.
  const filesForPackageHash = files.map((f) => (f.path === 'hook.yaml' ? { ...f, body: canonicalHookYamlBody(f.body) } : f));
  return {
    report: scanHookFiles(files, def.permissions, def.script),
    ledgerCandidate: {
      scriptHash: hashHookScript(entryFile.body),
      permissionsHash: hashHookPermissions(def.permissions),
      triggerHash: hashHookTrigger(def.on, def.matcher),
      packageHash: hashHookPackage(filesForPackageHash),
    },
  };
}

// Trust state — hookRunState re-scans CURRENT bytes every call and
// cross-checks ALL FOUR pinned hashes (script, permissions — JOB B —
// trigger — D-M — and the whole-package fingerprint — PIN A/B/C), so an
// edit to the script, the manifest, the trigger, OR ANY OTHER FILE in the
// package falls back to needing review. The "no packageHash ⇒ needsReview"
// clause is LOAD-BEARING (PIN C): a legacy entry has nothing to compare
// against, and treating a missing pin as "trust it" is the fail-open shape
// this fix exists to close.
//
// DECLINED HOOKS ARE NOT CONSULTED HERE (bead forge-8vfn.5.2, load-bearing):
// this function reads `approved` ONLY — never `readHookDeclinedLedger` — so
// a declined hook computes needsReview/runnable EXACTLY as an untouched
// never-reviewed hook does (no approved entry ⇒ needsReview:true,
// runnable:false). `declined` is a display label the bridge derives
// separately (computeTrust); it can never widen what this function grants.

export function hookRunState(forgeRoot: string, id: string): HookRunState {
  const { report, ledgerCandidate } = snapshotHookPackage(forgeRoot, id);
  const ledgerEntry = readHookApprovalLedger(forgeRoot).get(id);
  const needsReview =
    !ledgerEntry ||
    !ledgerEntry.packageHash ||
    ledgerEntry.packageHash !== ledgerCandidate.packageHash ||
    ledgerEntry.scriptHash !== ledgerCandidate.scriptHash ||
    ledgerEntry.permissionsHash !== ledgerCandidate.permissionsHash ||
    ledgerEntry.triggerHash !== ledgerCandidate.triggerHash;
  const runnable = !needsReview && (report.verdict !== 'blocked' || Boolean(ledgerEntry?.overridden));
  return { verdict: report.verdict, runnable, needsReview };
}

/**
 * Public predicate for "has an operator approved this, and does the approval
 * still cover the current bytes". `runHookScript` gates on the identical value
 * (`hookRunState(...).runnable`) rather than calling through here, because it
 * needs `verdict` and `needsReview` from the same state read for its refusal
 * message — one predicate, one meaning, no divergence risk.
 */
export function isHookRunnable(forgeRoot: string, id: string): boolean {
  return hookRunState(forgeRoot, id).runnable;
}

/** Deny-by-default approval: REFUSES a blocked verdict — only
 *  `overrideHookBlock` can flip a blocked hook to runnable, and it leaves the
 *  verdict `blocked` (an override never launders the verdict into "clean"). */
export function approveHook(input: { forgeRoot: string; id: string }): void {
  const { forgeRoot, id } = input;
  const { report, ledgerCandidate } = snapshotHookPackage(forgeRoot, id);
  if (report.verdict === 'blocked') {
    throw new Error(
      `approveHook: hook "${id}" scan verdict is "blocked" — approveHook refuses a blocked hook; use overrideHookBlock to explicitly accept the risk`,
    );
  }
  writeHookApprovalLedgerEntry(forgeRoot, {
    id,
    ...ledgerCandidate,
    overridden: false,
    approvedAt: new Date().toISOString(),
  });
}

/** A DISTINCT, separately-recorded act from a normal approval — stamps the
 *  ledger entry `overridden: true` + the reason, queryable and distinguishable
 *  from an ordinary clean/findings approval. */
export function overrideHookBlock(input: { forgeRoot: string; id: string; reason: string }): void {
  const { forgeRoot, id, reason } = input;
  if (!reason || !reason.trim()) {
    throw new Error('overrideHookBlock: a non-empty reason is required — the override must be explainable, not silent');
  }
  const { ledgerCandidate } = snapshotHookPackage(forgeRoot, id);
  writeHookApprovalLedgerEntry(forgeRoot, {
    id,
    ...ledgerCandidate,
    overridden: true,
    reason,
    approvedAt: new Date().toISOString(),
  });
}
