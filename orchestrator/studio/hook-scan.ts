/**
 * Hook security scan + trust/approval pipeline (R3-03-F2).
 *
 * Every hook entering the library passes a STATIC scan across four
 * categories before it is runnable: network egress (curl/wget/fetch/nc/raw
 * sockets), env reads (secret-shaped names — matched by SUFFIX, `*_TOKEN`,
 * `*_KEY`, ..., AND by PREFIX, `AZDO_*`/`GH_*` — see the comment on
 * SECRET_SHAPED_ENV_SUFFIX_RE / SECRET_SHAPED_ENV_PREFIX_RE below for the
 * over-flag-not-under-flag decision), file reads outside a curated
 * dangerous-path list
 * (`~/.ssh`, `secrets.env`, `id_rsa`, `.aws/credentials`), and obfuscation
 * (base64 decode pipelines, `eval`).
 *
 * Unlike R3-01's skill scan (facts only, no verdict — prose is unscannable),
 * this scan DOES produce a verdict: `blocked | findings | clean`, derived
 * from per-finding severity (`computeVerdict`). Deny-by-default: a hook is
 * never runnable until an operator explicitly approves it (`approveHook`) —
 * even a `clean` verdict does not auto-activate.
 *
 * Declared access NEVER removes a finding — the manifest declaring "this is
 * fine" is written by the same untrusted party as the script, so a scanner
 * that goes quiet on declared access would make the most dangerous hooks
 * produce the quietest reports. For NETWORK egress, declared access still
 * DOWNGRADES severity (the pre-existing, unchanged rule). For ENV reads and
 * FILE reads, declared access does NOT downgrade severity — a declared
 * secret-shaped env grant and a declared `~/.ssh`/`secrets.env`-shaped file
 * read both stay `critical` (2026-08-04, BLOCKER 2: severity now keys off the
 * CAPABILITY GRANT, not scanner detection or declaration — declaring a
 * secret-shaped name used to downgrade it to `info`, which made "declare the
 * exfiltration" both the way to obtain the real value at spawn time AND the
 * way to evade the blocked-combo override bar; see computeVerdict's own doc
 * comment for the verdict-side half of this fix).
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
 *
 * A SECOND, broader honest limit (2026-08-04 finding): this whole module is a
 * PRE-APPROVAL static scan, not a runtime enforcement mechanism, for three of
 * its four categories. `env` is the one dimension `hook-runtime.ts`'s
 * `buildHookChildEnv` actually PREVENTS at spawn time (structural env
 * stripping — see that module's own honesty block). `network-egress` and
 * `file-read` are declared (`permissions.network`/`permissions.read`) and
 * scanned for HERE, but nothing at spawn time stops the real `bash` process
 * from making a network call the four literal egress patterns don't match
 * (`/dev/tcp/`, `python3 -c`, `ssh`, `dig`, ...) or reading any file the OS
 * user can read. `file-write` isn't modelled at all — no manifest field, no
 * fifth scan category — so a hook can write, overwrite, or delete anything
 * the OS user can, entirely undeclared. Closing this for real means an
 * OS-level process isolator (restricted user/namespace/container/seccomp);
 * this repo's standing rule is not to re-invent one (CLAUDE.md: "Never
 * re-invent a job queue, worker pool, resource controller, or process
 * isolator"), so the boundary is drawn at "declared + statically scanned,
 * not runtime-enforced" on purpose, not by oversight.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { assertSkillSlug } from '../skill-path.ts';
import { reqString, optString } from './yaml-fields.ts';
import { hooksDir, loadHookDefinition, type HookPermissionManifest } from './hook-library.ts';
import { resolveGuardedPath } from '../../cli/studio-path-guard.ts';

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
 */
export interface HookApprovalLedgerEntry {
  id: string;
  scriptHash: string;
  permissionsHash: string;
  triggerHash: string;
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
 * `_KEY`, ...) OR by PREFIX (starts with `AZDO_`/`GH_` — the roadmap names
 * these prefixes explicitly). 2026-08-04 peer-review decision: ANY var name
 * prefixed with `AZDO_` or `GH_` is flagged regardless of whether it also
 * carries a recognised suffix — e.g. `GH_REPO` (no `_TOKEN`/`_KEY`/...
 * suffix) is still flagged. This deliberately OVER-flags a var like
 * `GH_REPO` that isn't actually secret-shaped: a false positive on a
 * non-secret prefix match is a strictly safer failure mode for a security
 * scanner than a false negative on a real credential, and an over-broad
 * manifest declaration (adding `GH_REPO` to `permissions.env`) is cheap for
 * an operator to make — see hook-scan.test.ts's "PREFIX rule" describe
 * block. A var matching BOTH rules (e.g. `GH_TOKEN`) is still reported
 * exactly once (scanEnvReads below filters on the COMBINED predicate over
 * distinct names, not once per rule).
 *
 * This prefix rule is orthogonal to — and does not defeat — the
 * fragmented-obfuscation gap the module header documents: a bare fragment
 * like "GH_TO" (half of a concatenation-built "GH_TOKEN") is not itself a
 * whole var-name token — `extractUppercaseWordTokens` (the MAJOR-fix,
 * bare-literal-inclusive candidate pool `scanEnvReads` filters through this
 * predicate) only ever sees "GH_TO" and the separate "KEN" as distinct
 * tokens, neither of which is secret-shaped on its own — so it is never a
 * candidate for either rule in the first place.
 */
const SECRET_SHAPED_ENV_SUFFIX_RE = /_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?|PAT)$/;
const SECRET_SHAPED_ENV_PREFIX_RE = /^(?:AZDO_|GH_)/;

function isSecretShapedEnvName(name: string): boolean {
  return SECRET_SHAPED_ENV_SUFFIX_RE.test(name) || SECRET_SHAPED_ENV_PREFIX_RE.test(name);
}

/** `$VAR` / `${VAR}` (default-value syntax `${VAR:-x}` / `${VAR:=x}`
 *  tolerated — only the name is captured) — uppercase-shaped names only, the
 *  standard env-var convention. Used by hook-runtime.ts's
 *  declared-vs-referenced mismatch check (`detectUndeclaredEnvRefs`), which
 *  is genuinely about shell variable SUBSTITUTION — deliberately narrower
 *  than `extractSecretShapedNameCandidates` below (NOT shared with it): a
 *  bare-literal broadening here would make that check flag a script as
 *  "referencing an undeclared var" for a plain-text mention (e.g. a
 *  comment), which is not what that check means. */
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

/**
 * MAJOR fix (2026-08-04, third adversarial review, D-L): `extractEnvVarNames`
 * above only matches `$VAR`/`${VAR}` shell-substitution syntax — a script
 * reading a secret via `printenv ANTHROPIC_API_KEY`, `env | grep GH_TOKEN`,
 * or Python's `os.environ['ANTHROPIC_API_KEY']` produced ZERO env-read
 * findings, structurally invisible rather than merely downgraded. This
 * extracts every distinct uppercase-shaped WHOLE-WORD token anywhere in the
 * body — after `$`/`${`, inside quotes/brackets, after `printenv`/`env|grep`,
 * or in a comment — deliberately a SUPERSET of `extractEnvVarNames` (any
 * `$VAR` reference is also a bare uppercase token), used ONLY as the
 * candidate pool `scanEnvReads` then filters down to secret-shaped names.
 * ACCEPTED TRADEOFF (D-L, documented not hidden): a secret-shaped name
 * mentioned in a comment or descriptive string is also caught — a false
 * positive there costs one manifest declaration; a false negative on a real
 * bare-literal credential read is the exact failure this feature exists to
 * prevent.
 */
function extractUppercaseWordTokens(body: string): string[] {
  const re = /\b[A-Z_][A-Z0-9_]*\b/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) names.add(m[0]);
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

/**
 * BLOCKER 2 fix (2026-08-04, third adversarial review, D-K): severity now
 * keys off the CAPABILITY GRANT, not scanner detection, and NEVER downgrades
 * for a declared secret-shaped name — declaring `ANTHROPIC_API_KEY` in
 * `permissions.env` used to downgrade the finding to `info`, which made
 * "declare the exfiltration" both necessary to obtain the real value (only a
 * manifest-granted var reaches the child, see hook-runtime.ts) and sufficient
 * to evade the blocked-combo override bar — an attacker who declared the
 * grant faced LESS friction than one who didn't. Now: a secret-shaped name is
 * a critical finding whether it comes from the MANIFEST (`permissions.env`,
 * scanned directly — fires even with zero body references) or the SCRIPT
 * BODY (via `extractUppercaseWordTokens`, catching both `$VAR` substitution
 * and MAJOR-fix bare literals), unioned and deduplicated by name. `declared`
 * is still recorded as a fact for the operator's report — it just no longer
 * buys a lower severity, mirroring file-read's existing never-downgraded
 * treatment.
 */
function scanEnvReads(body: string, permissions: HookPermissionManifest): HookScanFinding[] {
  const namesFromBody = extractUppercaseWordTokens(body).filter(isSecretShapedEnvName);
  const namesFromManifest = permissions.env.filter(isSecretShapedEnvName);
  const names = new Set([...namesFromBody, ...namesFromManifest]);
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const declared = permissions.env.includes(name);
      return {
        category: 'env-read' as const,
        severity: 'critical' as HookFindingSeverity,
        declared,
        match: name,
        message: `Script grants and/or reads secret-shaped env var "${name}"${declared ? ' — DECLARED in permissions.env (a declared secret-shaped grant is never downgraded, BLOCKER 2)' : ' — UNDECLARED'}`,
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

/**
 * BLOCKER 2 fix (D-K): the combo condition is now PRESENCE-based — an
 * env-read finding together with a network-egress finding, REGARDLESS of
 * either one's `severity`/`declared` — not severity-based as before (which
 * required BOTH to be undeclared-critical, so a fully-declared exfiltration
 * shape scored `findings`, one tier short of the override bar it should have
 * hit). Declaring everything no longer launders the exfiltration shape past
 * `blocked`. A lone network-egress finding with no accompanying env-read
 * finding still stays `findings` — declaring network access ALONE, with no
 * secret-shaped grant/reference anywhere, still reduces friction for a
 * genuinely benign hook; this fix does not become "everything is blocked".
 */
function computeVerdict(findings: readonly HookScanFinding[]): HookScanVerdict {
  if (findings.some((f) => f.category === 'obfuscation')) return 'blocked';
  if (findings.some((f) => f.category === 'file-read')) return 'blocked';
  const hasEnvRead = findings.some((f) => f.category === 'env-read');
  const hasNetworkEgress = findings.some((f) => f.category === 'network-egress');
  if (hasEnvRead && hasNetworkEgress) return 'blocked';
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

/**
 * Read a hook's script body through the shared containment guard.
 *
 * `loadHookDefinition` already rejects a `script:` that escapes the hook
 * directory (`resolveHookScriptPath` — lexical + percent-decoded + a realpath
 * check CONDITIONAL on the entry existing). Two gaps remain, which is why the
 * read is guarded here rather than trusting that upstream validation:
 *   - that realpath check is skipped entirely for a DANGLING symlink, and it
 *     has no `nlink` check, so a hardlinked script leaf is invisible to it;
 *   - it is a `startsWith(boundary)` containment test, not a per-segment
 *     IDENTITY test, so a script resolving to a DIFFERENT real object inside
 *     the same hook directory passes.
 * `hooksDir` is the fixed containment root and `id` is its own segment; the
 * script's own relative components follow as further segments, so each is
 * identity-checked rather than joined blind (./studio-path-guard.ts, CONTRACT).
 *
 * Empty and `.` components are dropped — `path.resolve` tolerates them
 * everywhere else, so rejecting a legitimate `scripts//run.sh` here would make
 * a valid hook unreadable. A `..` is deliberately NOT dropped: it must reach
 * `isSafeSegment` and be rejected.
 */
function readHookScriptBody(forgeRoot: string, id: string): string {
  const def = loadHookDefinition(id, forgeRoot);
  const segments = def.script.split('/').filter((seg) => seg !== '' && seg !== '.');
  const guarded = resolveGuardedPath(hooksDir(forgeRoot), [id, ...segments]);
  if (!guarded.ok || !guarded.exists) {
    throw new Error(`hook "${id}" script is not readable within its own package`);
  }
  return readFileSync(guarded.realPath, 'utf8');
}

export function scanHookPackage(forgeRoot: string, id: string): HookScanReport {
  const def = loadHookDefinition(id, forgeRoot);
  return scanHookScript({ body: readHookScriptBody(forgeRoot, id), permissions: def.permissions });
}

// ---------------------------------------------------------------------------
// hashHookScript / hashHookPermissions / hashHookTrigger — deterministic
// content pins for the approval ledger, deliberately SEPARATE (see
// HookApprovalLedgerEntry's own doc comment / JOB B, D-M): a mismatch on one
// must never be mistaken for another.
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
      scriptHash: reqString(e, 'scriptHash', file),
      permissionsHash: reqString(e, 'permissionsHash', file),
      triggerHash: reqString(e, 'triggerHash', file),
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

/** The ledger's `revoked` list (W7-B4, library-08) — the RECORDED history of
 *  revocations. Read tolerantly for round-tripping only: `readHookApprovalLedger`
 *  (the runtime authority) never consults it, so a revoked entry can never be
 *  mistaken for a live approval. A missing file or absent list is `[]`; an
 *  unreadable/unparseable EXISTING file fails loud exactly like
 *  `readHookApprovalLedger` (same file, same contract). */
function readHookLedgerRevoked(forgeRoot: string): unknown[] {
  const file = hookApprovalLedgerPath(forgeRoot);
  if (!existsSync(file)) return [];
  const parsed = yaml.load(readFileSync(file, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const revoked = (parsed as Record<string, unknown>)['revoked'];
  return Array.isArray(revoked) ? revoked : [];
}

/** One writer for the whole ledger document — `approved` (sorted) plus the
 *  carried-through `revoked` history, so no code path can drop one half while
 *  writing the other. */
function writeHookLedgerDoc(forgeRoot: string, approvedMap: Map<string, HookApprovalLedgerEntry>, revoked: unknown[]): void {
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  const approved = [...approvedMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(
    hookApprovalLedgerPath(forgeRoot),
    yaml.dump({ approved, ...(revoked.length > 0 ? { revoked } : {}) }),
    'utf8',
  );
}

export function writeHookApprovalLedgerEntry(forgeRoot: string, entry: HookApprovalLedgerEntry): void {
  const ledger = readHookApprovalLedger(forgeRoot);
  const revoked = readHookLedgerRevoked(forgeRoot);
  ledger.set(entry.id, entry);
  writeHookLedgerDoc(forgeRoot, ledger, revoked);
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
  writeHookLedgerDoc(forgeRoot, ledger, revoked);
}

// ---------------------------------------------------------------------------
// Trust state — hookRunState re-scans CURRENT bytes every call (never trusts
// a cached verdict), and cross-checks ALL THREE of the ledger's pinned
// hashes (script, permissions — JOB B — AND trigger — D-M) against
// freshly-recomputed ones so an edit to ANY of the script, the manifest, or
// the trigger condition after approval falls back to needing review (mirrors
// R3-01's changed-hash-forces-re-review rule, now covering the triple rather
// than the script alone).
// ---------------------------------------------------------------------------

export function hookRunState(forgeRoot: string, id: string): HookRunState {
  const report = scanHookPackage(forgeRoot, id);
  const def = loadHookDefinition(id, forgeRoot);
  const currentScriptHash = hashHookScript(readHookScriptBody(forgeRoot, id));
  const currentPermissionsHash = hashHookPermissions(def.permissions);
  const currentTriggerHash = hashHookTrigger(def.on, def.matcher);
  const ledgerEntry = readHookApprovalLedger(forgeRoot).get(id);
  const needsReview =
    !ledgerEntry ||
    ledgerEntry.scriptHash !== currentScriptHash ||
    ledgerEntry.permissionsHash !== currentPermissionsHash ||
    ledgerEntry.triggerHash !== currentTriggerHash;
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
  const report = scanHookPackage(forgeRoot, id);
  if (report.verdict === 'blocked') {
    throw new Error(
      `approveHook: hook "${id}" scan verdict is "blocked" — approveHook refuses a blocked hook; use overrideHookBlock to explicitly accept the risk`,
    );
  }
  const def = loadHookDefinition(id, forgeRoot);
  writeHookApprovalLedgerEntry(forgeRoot, {
    id,
    scriptHash: hashHookScript(readHookScriptBody(forgeRoot, id)),
    permissionsHash: hashHookPermissions(def.permissions),
    triggerHash: hashHookTrigger(def.on, def.matcher),
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
  const def = loadHookDefinition(id, forgeRoot);
  writeHookApprovalLedgerEntry(forgeRoot, {
    id,
    scriptHash: hashHookScript(readHookScriptBody(forgeRoot, id)),
    permissionsHash: hashHookPermissions(def.permissions),
    triggerHash: hashHookTrigger(def.on, def.matcher),
    overridden: true,
    reason,
    approvedAt: new Date().toISOString(),
  });
}
