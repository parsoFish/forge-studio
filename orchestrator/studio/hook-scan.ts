/**
 * Hook security scan + trust/approval pipeline (R3-03-F2).
 *
 * Every hook entering the library passes a STATIC scan across four
 * categories before it is runnable: network egress (curl/wget/fetch/nc/raw
 * sockets), env reads (secret-shaped names — `*_TOKEN`, `*_KEY`, ... —
 * matched by SUFFIX, see the comment on SECRET_SHAPED_ENV_SUFFIX_RE below for
 * why a prefix-wildcard reading of "AZDO_*, GH_*" is deliberately NOT what
 * this implements), file reads outside a curated dangerous-path list
 * (`~/.ssh`, `secrets.env`, `id_rsa`, `.aws/credentials`), and obfuscation
 * (base64 decode pipelines, `eval`).
 *
 * Unlike R3-01's skill scan (facts only, no verdict — prose is unscannable),
 * this scan DOES produce a verdict: `blocked | findings | clean`, derived
 * from per-finding severity (`computeVerdict`). Deny-by-default: a hook is
 * never runnable until an operator explicitly approves it (`approveHook`) —
 * even a `clean` verdict does not auto-activate.
 *
 * Declared access DOWNGRADES a finding's severity, it never removes it — the
 * manifest declaring "this is fine" is written by the same untrusted party as
 * the script, so a scanner that goes quiet on declared access would make the
 * most dangerous hooks produce the quietest reports. `~/.ssh` /
 * `secrets.env`-shaped file reads are the one deliberate exception: NEVER
 * suppressible or downgradeable by declaration.
 *
 * The trust/approval ledger (`studio/hook-approvals.yaml`) mirrors R3-01's
 * skill install ledger (`skill-install-ledger.ts`) — a hash pinned only
 * inside the file it protects is not a pin (deleting/editing it defeats it
 * alongside the file), so a SEPARATE git-tracked ledger is the second source
 * of truth `hookRunState` cross-checks against. Same honesty constraint as
 * that module: this is NOT tamper-proof, it only closes the single-file
 * blind spot.
 *
 * HONEST LIMIT (stated, not overclaimed): this is a modest static
 * regex/substring scanner over the raw script body — it does not parse or
 * execute the script. A sufficiently fragmented/obfuscated command that never
 * spells a flagged token as a contiguous literal, and uses neither base64 nor
 * eval, defeats it. This is a documented boundary, not a bug to be quietly
 * patched — see hook-scan.test.ts's own pinned "DOCUMENTED GAP" case.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { assertSkillSlug } from '../skill-path.ts';
import { reqString, optString } from './yaml-fields.ts';
import { hookDir, loadHookDefinition, type HookPermissionManifest } from './hook-library.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookScanCategory = 'network-egress' | 'env-read' | 'file-read' | 'obfuscation';
export type HookFindingSeverity = 'critical' | 'info';

export interface HookScanFinding {
  category: HookScanCategory;
  severity: HookFindingSeverity;
  message: string;
  match: string;
  declared: boolean;
}

export type HookScanVerdict = 'blocked' | 'findings' | 'clean';

export interface HookScanReport {
  verdict: HookScanVerdict;
  findings: HookScanFinding[];
}

export interface HookApprovalLedgerEntry {
  id: string;
  contentHash: string;
  overridden: boolean;
  reason?: string;
  approvedAt: string;
}

export interface HookRunState {
  verdict: HookScanVerdict;
  runnable: boolean;
  needsReview: boolean;
}

// ---------------------------------------------------------------------------
// Pattern constants — no magic literals scattered through the scan logic.
// ---------------------------------------------------------------------------

const NETWORK_EGRESS_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\bcurl\b/, label: 'curl' },
  { re: /\bwget\b/, label: 'wget' },
  { re: /\bfetch\s*\(/, label: 'fetch(' },
  { re: /\bnc\b/, label: 'nc' },
  { re: /\b(?:socket\.socket|net\.connect)\s*\(/, label: 'raw socket' },
];

const DANGEROUS_FILE_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\.ssh\b/, label: '~/.ssh' },
  { re: /secrets\.env\b/, label: 'secrets.env' },
  { re: /id_rsa\b/, label: 'id_rsa' },
  { re: /\.aws\/credentials\b/, label: '.aws/credentials' },
];

const OBFUSCATION_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\beval\b/, label: 'eval' },
  { re: /base64\s+(?:-d|--decode)\b/, label: 'base64 decode' },
  { re: /\batob\s*\(/, label: 'atob(' },
];

/**
 * Env vars are flagged as secret-shaped by SUFFIX (ends with `_TOKEN`,
 * `_KEY`, ...), never by the "AZDO_*"/"GH_*" PREFIX reading the roadmap text
 * also lists — a prefix-wildcard match would flag a bare fragment like
 * "GH_TO" (half of a concatenation-obfuscated "GH_TOKEN") as a real secret
 * read, which is exactly backwards: hook-scan.test.ts's own documented-gap
 * fixture pins that such a fragment must NOT be flagged (it isn't a real
 * reference to any actual secret name). "AZDO_*, GH_*" in the roadmap text
 * are read here as illustrative real var-name examples (AZDO_TOKEN,
 * GH_TOKEN, ...) that already end in a flagged suffix, not a separate
 * prefix rule.
 */
const SECRET_SHAPED_ENV_SUFFIX_RE = /_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?|PAT)$/;

/** `$VAR` / `${VAR}` (default-value syntax `${VAR:-x}` / `${VAR:=x}`
 *  tolerated — only the name is captured) — uppercase-shaped names only, the
 *  standard env-var convention. Shared by this module's secret-shape filter
 *  and hook-runtime.ts's declared-vs-referenced mismatch check. */
const ENV_VAR_REF_SOURCE = String.raw`\$\{([A-Z_][A-Z0-9_]*)(?:[:][-=][^}]*)?\}|\$([A-Z_][A-Z0-9_]*)`;

/** Every distinct uppercase-shaped env-var reference in a script body. */
export function extractEnvVarNames(body: string): string[] {
  const re = new RegExp(ENV_VAR_REF_SOURCE, 'g');
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1] ?? m[2];
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Per-category scanners — each returns AT MOST ONE finding per category
// (aggregating every matched pattern into that one finding's `match` field),
// so a script tripping several patterns in the same category still reads as
// one clear signal, not a flood.
// ---------------------------------------------------------------------------

function scanNetworkEgress(body: string, permissions: HookPermissionManifest): HookScanFinding[] {
  const matched = NETWORK_EGRESS_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.label);
  if (matched.length === 0) return [];
  const declared = permissions.network === true;
  return [
    {
      category: 'network-egress',
      severity: declared ? 'info' : 'critical',
      declared,
      match: matched.join(', '),
      message: `Script performs network egress (${matched.join(', ')})${declared ? ' — declared in permissions.network' : ' — UNDECLARED (permissions.network is false)'}`,
    },
  ];
}

function scanEnvReads(body: string, permissions: HookPermissionManifest): HookScanFinding[] {
  const secretNames = extractEnvVarNames(body).filter((name) => SECRET_SHAPED_ENV_SUFFIX_RE.test(name));
  return secretNames.map((name) => {
    const declared = permissions.env.includes(name);
    return {
      category: 'env-read' as const,
      severity: (declared ? 'info' : 'critical') as HookFindingSeverity,
      declared,
      match: name,
      message: `Script reads secret-shaped env var "${name}"${declared ? ' — declared in permissions.env' : ' — UNDECLARED'}`,
    };
  });
}

function scanFileReads(body: string, permissions: HookPermissionManifest): HookScanFinding[] {
  const matched = DANGEROUS_FILE_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.label);
  if (matched.length === 0) return [];
  // Informational only — file-read severity is NEVER downgraded by
  // declaration (the one deliberate exception; see the module header).
  const declared = matched.some((label) => permissions.read.includes(label));
  return [
    {
      category: 'file-read',
      severity: 'critical',
      declared,
      match: matched.join(', '),
      message: `Script reads a curated dangerous path (${matched.join(', ')}) — file-read findings are never downgraded or suppressed by permissions.read declaration`,
    },
  ];
}

function scanObfuscation(body: string): HookScanFinding[] {
  const matched = OBFUSCATION_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.label);
  if (matched.length === 0) return [];
  return [
    {
      category: 'obfuscation',
      severity: 'critical',
      declared: false,
      match: matched.join(', '),
      message: `Script uses obfuscation-shaped constructs (${matched.join(', ')}) — hides intent from static review`,
    },
  ];
}

function computeVerdict(findings: readonly HookScanFinding[]): HookScanVerdict {
  if (findings.some((f) => f.category === 'obfuscation')) return 'blocked';
  if (findings.some((f) => f.category === 'file-read')) return 'blocked';
  const criticalEnv = findings.some((f) => f.category === 'env-read' && f.severity === 'critical');
  const criticalNetwork = findings.some((f) => f.category === 'network-egress' && f.severity === 'critical');
  if (criticalEnv && criticalNetwork) return 'blocked';
  return findings.length > 0 ? 'findings' : 'clean';
}

// ---------------------------------------------------------------------------
// scanHookScript (pure) / scanHookPackage (disk-reading wrapper)
// ---------------------------------------------------------------------------

export function scanHookScript(input: { body: string; permissions: HookPermissionManifest }): HookScanReport {
  const { body, permissions } = input;
  const findings: HookScanFinding[] = [
    ...scanNetworkEgress(body, permissions),
    ...scanEnvReads(body, permissions),
    ...scanFileReads(body, permissions),
    ...scanObfuscation(body),
  ];
  return { verdict: computeVerdict(findings), findings };
}

function readHookScriptBody(forgeRoot: string, id: string): string {
  const def = loadHookDefinition(id, forgeRoot);
  const scriptPath = join(hookDir(id, forgeRoot), def.script);
  return readFileSync(scriptPath, 'utf8');
}

export function scanHookPackage(forgeRoot: string, id: string): HookScanReport {
  const def = loadHookDefinition(id, forgeRoot);
  return scanHookScript({ body: readHookScriptBody(forgeRoot, id), permissions: def.permissions });
}

// ---------------------------------------------------------------------------
// hashHookScript — deterministic content pin for the approval ledger.
// ---------------------------------------------------------------------------

export function hashHookScript(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

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
      contentHash: reqString(e, 'contentHash', file),
      overridden: e['overridden'] === true,
      reason: optString(e, 'reason'),
      approvedAt: reqString(e, 'approvedAt', file),
    };
  });
}

/** Absent file ⇒ empty map (nothing has ever been approved). A file that
 *  EXISTS but fails to parse fails LOUD — never silently "no ledger". */
export function readHookApprovalLedger(forgeRoot: string): Map<string, HookApprovalLedgerEntry> {
  const file = hookApprovalLedgerPath(forgeRoot);
  if (!existsSync(file)) return new Map();

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

  const entries = parseHookApprovalLedgerEntries((parsed as Record<string, unknown>)['approved'], file);
  return new Map(entries.map((e) => [e.id, e]));
}

export function writeHookApprovalLedgerEntry(forgeRoot: string, entry: HookApprovalLedgerEntry): void {
  const ledger = readHookApprovalLedger(forgeRoot);
  ledger.set(entry.id, entry);
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  const approved = [...ledger.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(hookApprovalLedgerPath(forgeRoot), yaml.dump({ approved }), 'utf8');
}

// ---------------------------------------------------------------------------
// Trust state — hookRunState re-scans CURRENT bytes every call (never trusts
// a cached verdict), and cross-checks the ledger's pinned hash against the
// freshly-recomputed one so an edit after approval falls back to needing
// review (mirrors R3-01's changed-hash-forces-re-review rule).
// ---------------------------------------------------------------------------

export function hookRunState(forgeRoot: string, id: string): HookRunState {
  const report = scanHookPackage(forgeRoot, id);
  const currentHash = hashHookScript(readHookScriptBody(forgeRoot, id));
  const ledgerEntry = readHookApprovalLedger(forgeRoot).get(id);
  const needsReview = !ledgerEntry || ledgerEntry.contentHash !== currentHash;
  const runnable = !needsReview && (report.verdict !== 'blocked' || Boolean(ledgerEntry?.overridden));
  return { verdict: report.verdict, runnable, needsReview };
}

export function isHookRunnable(forgeRoot: string, id: string): boolean {
  return hookRunState(forgeRoot, id).runnable;
}

/** Deny-by-default approval: REFUSES a blocked verdict — only
 *  `overrideHookBlock` can flip a blocked hook to runnable, and it leaves the
 *  verdict `blocked` (an override never launders the verdict into "clean"). */
export function approveHook(input: { forgeRoot: string; id: string }): void {
  const { forgeRoot, id } = input;
  const report = scanHookPackage(forgeRoot, id);
  if (report.verdict === 'blocked') {
    throw new Error(
      `approveHook: hook "${id}" scan verdict is "blocked" — approveHook refuses a blocked hook; use overrideHookBlock to explicitly accept the risk`,
    );
  }
  const currentHash = hashHookScript(readHookScriptBody(forgeRoot, id));
  writeHookApprovalLedgerEntry(forgeRoot, {
    id,
    contentHash: currentHash,
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
  const currentHash = hashHookScript(readHookScriptBody(forgeRoot, id));
  writeHookApprovalLedgerEntry(forgeRoot, {
    id,
    contentHash: currentHash,
    overridden: true,
    reason,
    approvedAt: new Date().toISOString(),
  });
}
