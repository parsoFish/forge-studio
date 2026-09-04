/**
 * Hook security scan + trust/approval pipeline (R3-03-F2).
 *
 * Every hook entering the library passes a STATIC scan across four
 * categories before it is runnable: network egress (curl/wget/fetch/nc/raw
 * sockets, plus — since W8-B6 — bash's own `/dev/tcp/` and `/dev/udp/`
 * redirections, `dig`, `ssh`, `python -c` and `openssl s_client`), env reads
 * (secret-shaped names — matched by SUFFIX, `*_TOKEN`, `*_KEY`, ..., AND by
 * PREFIX, `AZDO_*`/`GH_*` — see the comment on SECRET_SHAPED_ENV_SUFFIX_RE /
 * SECRET_SHAPED_ENV_PREFIX_RE below for the over-flag-not-under-flag
 * decision), file reads inside a curated dangerous-path list (`~/.ssh`,
 * `secrets.env`, `id_rsa`, `.aws/credentials`, and — since W8-B6 —
 * `.netrc`, `.docker/config.json`, `.kube/config`, `.npmrc`, `.config/gh/`,
 * `.git-credentials`, `.azure/`, `.config/gcloud/`), and obfuscation
 * (base64 decode pipelines, `eval`).
 *
 * Unlike R3-01's skill scan (facts only, no verdict — prose is unscannable),
 * this scan DOES produce a verdict: `blocked | findings | clean`, derived
 * from per-finding severity (`computeVerdict`): ANY `critical` finding is
 * `blocked` on its own (W8-B6 — the older env-read + network-egress PAIRING
 * rule is retired; see computeVerdict's own comment for the review that
 * defeated it). Deny-by-default: a hook is never runnable until an operator
 * explicitly approves it (`approveHook`) — even a `clean` verdict does not
 * auto-activate.
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
 * AMENDED 2026-08-28 (hostile review — PIN A/B/C below, PIN D in
 * hook-runtime.test.ts): "single-file" undersold it — a hook is a PACKAGE
 * DIRECTORY, and a declared entry script can legitimately `source` a sibling
 * (hook-package.ts's header). Ledger and scan used to look at only that ONE
 * file; both now cover the WHOLE package (`packageHash`, see below).
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
 * from making a network call the egress patterns don't match or reading any
 * file the OS user can read. W8-B6 widened both lists (the four shapes this
 * paragraph used to name as examples — `/dev/tcp/`, `python3 -c`, `ssh`,
 * `dig` — are all detected now), but widening an enumeration never closes
 * it: the property is unchanged, only the specific known holes are. `file-write` isn't modelled at all — no manifest field, no
 * fifth scan category — so a hook can write, overwrite, or delete anything
 * the OS user can, entirely undeclared. Closing this for real means an
 * OS-level process isolator (restricted user/namespace/container/seccomp);
 * this repo's standing rule is not to re-invent one (CLAUDE.md: "Never
 * re-invent a job queue, worker pool, resource controller, or process
 * isolator"), so the boundary is drawn at "declared + statically scanned,
 * not runtime-enforced" on purpose, not by oversight.
 */

import { loadHookDefinition, type HookPermissionManifest } from './hook-library.ts';
import {
  readHookPackage,
  selectScannableHookFiles,
  normalizeHookEntryPath,
  type HookPackageFile,
} from './hook-package.ts';

export { hashHookScript, hashHookPermissions, hashHookTrigger } from './hook-package.ts';

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
  /** Additive-optional: which PACKAGE FILE this finding came from, when
   *  supplied. Omitted entirely (never "") when unset, so every existing
   *  single-body caller stays unaffected. */
  path?: string;
}

export type HookScanVerdict = 'blocked' | 'findings' | 'clean';

export interface HookScanReport {
  verdict: HookScanVerdict;
  findings: HookScanFinding[];
}


// ---------------------------------------------------------------------------
// Pattern constants — no magic literals scattered through the scan logic.
// ---------------------------------------------------------------------------

/**
 * W8-B6 FIX-1 layer 3 (2026-08-24, hostile review): the last five entries are
 * new. The list used to be curl/wget/fetch(/nc/raw-socket — an enumeration of
 * what its author had thought of — and this module's own header already NAMED
 * the shapes it missed. The reviewer simply used one: a hook shipping a stolen
 * token over bash's `/dev/tcp/` redirection needs no external binary at all,
 * so it matched nothing and scored `clean`.
 *
 * Still an enumeration, and still defeatable — see the DOCUMENTED GAP in
 * hook-scan.test.ts, which stands unchanged and honest. What changed is that
 * the shapes a reviewer actually walked through are no longer free.
 *
 * `\bssh\b` deliberately also matches the `ssh` inside a `~/.ssh` path, so a
 * script reading an SSH key reports BOTH a file-read and a network-egress
 * finding. That is an over-flag, kept on purpose: it costs an operator one
 * line in an override reason, it never changes the verdict (either finding is
 * critical, so either one blocks), and the alternative — a cleverer pattern —
 * trades a real detection for a cosmetic one. Same over-flag-not-under-flag
 * reasoning already written down for the `AZDO_`/`GH_` env PREFIX rule below.
 */
const NETWORK_EGRESS_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\bcurl\b/, label: 'curl' },
  { re: /\bwget\b/, label: 'wget' },
  { re: /\bfetch\s*\(/, label: 'fetch(' },
  { re: /\bnc\b/, label: 'nc' },
  { re: /\b(?:socket\.socket|net\.connect)\s*\(/, label: 'raw socket' },
  { re: /\/dev\/tcp\//, label: '/dev/tcp/' },
  { re: /\/dev\/udp\//, label: '/dev/udp/' },
  { re: /\bdig\b/, label: 'dig' },
  { re: /\bssh\b/, label: 'ssh' },
  { re: /\bpython3?\s+-c/, label: 'python -c' },
  { re: /\bopenssl\s+s_client\b/, label: 'openssl s_client' },
];

/**
 * W8-B6 FIX-1 layer 3 (2026-08-24, hostile review): the last six entries are
 * new. The curated list was `~/.ssh`, `secrets.env`, `id_rsa`,
 * `.aws/credentials` — four literals, so a hook reading the gh CLI's OWN OAuth
 * token out of `~/.config/gh/hosts.yml` produced zero findings. The reviewer
 * printed a planted credential from a real spawn to prove it.
 *
 * Every added entry is a path a mainstream tool stores a live credential in:
 * `.netrc` (curl/git/ftp), `.docker/config.json` (registry auth),
 * `.kube/config` (cluster tokens/certs), `.npmrc` (registry auth token),
 * `.config/gh/` (the gh CLI's OAuth token — the reviewer's own route),
 * `.git-credentials` (git's plaintext store), plus the two cloud CLI
 * credential DIRECTORIES that had no coverage at all, `.azure/` and
 * `.config/gcloud/`. AWS's is already covered file-wise by the pre-existing
 * `.aws/credentials`, which is left exactly as it is rather than broadened to
 * `.aws/` — that would report the same read under two labels for no gain.
 *
 * Directory-level rather than file-level for `.config/gh/`, `.azure/` and
 * `.config/gcloud/` on purpose: the credential FILE inside each is an
 * implementation detail of the tool that owns it (gh alone has moved its
 * token between files), and matching the directory cannot be defeated by the
 * tool renaming its store.
 */
const DANGEROUS_FILE_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\.ssh\b/, label: '~/.ssh' },
  { re: /secrets\.env\b/, label: 'secrets.env' },
  { re: /id_rsa\b/, label: 'id_rsa' },
  { re: /\.aws\/credentials\b/, label: '.aws/credentials' },
  { re: /\.netrc\b/, label: '.netrc' },
  { re: /\.docker\/config\.json\b/, label: '.docker/config.json' },
  { re: /\.kube\/config\b/, label: '.kube/config' },
  { re: /\.npmrc\b/, label: '.npmrc' },
  { re: /\.config\/gh\//, label: '.config/gh/' },
  { re: /\.git-credentials\b/, label: '.git-credentials' },
  { re: /\.azure\//, label: '.azure/' },
  { re: /\.config\/gcloud\//, label: '.config/gcloud/' },
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
 * W8-B6 FIX-1 layer 2 (2026-08-24, hostile review of the first production
 * caller of `runHookScript`): ANY `critical` finding blocks on its own.
 *
 * This REPLACES the four-clause rule below it — obfuscation blocks,
 * file-read blocks, env-read+network-egress blocks, everything else is
 * `findings` — which the review broke by attacking its weakest clause. An
 * env-read finding could only reach `blocked` PAIRED with a *detected*
 * network-egress finding, and this module's own header documents the egress
 * shapes the pattern list misses (`/dev/tcp/`, `python3 -c`, `ssh`, `dig`).
 * "No egress finding" is therefore not evidence of no egress path, so a lone
 * critical capability grant scored `findings` — which `approveHook` accepts
 * with no override and no reason, and which `apps/studio/app/hooks/[id]` renders
 * with the same one-click Approve as `clean`. The reviewer approved a hook
 * declaring `permissions.env: ["GH_TOKEN"]` through that ordinary path and its
 * child printed the operator's real token. A gate whose second half is
 * documented as evadable is not a gate.
 *
 * Keyed off SEVERITY rather than category, for three reasons: it subsumes all
 * three old blocking clauses exactly (obfuscation and file-read are
 * unconditionally `critical`, and the pairing's members are `critical`
 * whenever they matter); it leaves the module's ONE deliberate downgrade — a
 * DECLARED network egress scores `info` — doing precisely the friction
 * reduction it was added for, so a genuinely benign declared-network hook
 * keeps its one-click approve and this does NOT become "everything is
 * blocked"; and a future finding category inherits the rule by construction
 * instead of needing a fifth clause someone must remember to add.
 *
 * This FORBIDS nothing. `blocked` keeps its escape hatch — `overrideHookBlock`
 * demands a non-empty reason and stamps the ledger `overridden: true`, a
 * separately-recorded act. What changes is that granting a hook a credential
 * costs a deliberate, audited decision instead of a silent click.
 */
function computeVerdict(findings: readonly HookScanFinding[]): HookScanVerdict {
  if (findings.some((f) => f.severity === 'critical')) return 'blocked';
  return findings.length > 0 ? 'findings' : 'clean';
}

// ---------------------------------------------------------------------------
// scanHookScript (pure, single-body, unchanged shape) / scanHookFiles (pure,
// whole-package) / scanHookPackage (disk-reading wrapper). `path` threads
// onto every finding so a multi-file caller can tell which file it came
// from; omitted (never "") when unset.
// ---------------------------------------------------------------------------

export function scanHookScript(input: { body: string; permissions: HookPermissionManifest; path?: string }): HookScanReport {
  const { body, permissions, path } = input;
  const findings: HookScanFinding[] = [
    ...scanNetworkEgress(body, permissions),
    ...scanEnvReads(body, permissions),
    ...scanFileReads(body, permissions),
    ...scanObfuscation(body),
  ].map((f) => (path !== undefined ? { ...f, path } : f));
  return { verdict: computeVerdict(findings), findings };
}

/**
 * Scan an already-read hook package's SELECTED files
 * (`selectScannableHookFiles`, hook-package.ts) and compute ONE verdict over
 * their union — the single "scan these files, dedupe env-read, compute the
 * verdict" primitive both `scanHookPackage` (post-install) and
 * `packages/library/bridge-studio-community.ts`'s pre-install preview use, so a package
 * that scans `blocked` after install can never have previewed `clean` (PIN B).
 * Deny-by-default on a missing entry: throws naming `entryPath` if absent
 * from `files`, rather than reporting a verdict over nothing scanned.
 *
 * DEDUPES `env-read` findings by `match` (the var name), first occurrence
 * wins: `scanEnvReads` also scans `permissions.env` (the MANIFEST, identical
 * per file), so without this a multi-file package reports the same grant
 * once PER FILE. The other three categories are body-derived, so a real
 * `curl` in two files is two real findings and must NOT be deduped. `files`
 * scans entry-first, so a deduped finding attributes to the entry script.
 *
 * `path` is threaded onto each finding only when >1 file was selected — a
 * single-script package stays byte-identical to a bare `scanHookScript` call,
 * preserving `scanHookPackage`'s pre-existing single-file contract.
 */
export function scanHookFiles(
  files: readonly HookPackageFile[],
  permissions: HookPermissionManifest,
  entryPath: string,
): HookScanReport {
  const selected = selectScannableHookFiles(files, entryPath);
  const normalizedEntry = normalizeHookEntryPath(entryPath);
  if (!selected.some((f) => normalizeHookEntryPath(f.path) === normalizedEntry)) {
    throw new Error(
      `scanHookFiles: declared entry script "${entryPath}" is not among this package's files — refusing to scan nothing and report a false "clean"`,
    );
  }
  const threadPath = selected.length > 1;

  const seenEnvNames = new Set<string>();
  const findings: HookScanFinding[] = [];
  for (const file of selected) {
    const report = scanHookScript({ body: file.body, permissions, ...(threadPath ? { path: file.path } : {}) });
    for (const finding of report.findings) {
      if (finding.category === 'env-read') {
        if (seenEnvNames.has(finding.match)) continue;
        seenEnvNames.add(finding.match);
      }
      findings.push(finding);
    }
  }
  return { verdict: computeVerdict(findings), findings };
}

export function scanHookPackage(forgeRoot: string, id: string): HookScanReport {
  const def = loadHookDefinition(id, forgeRoot);
  const files = readHookPackage(forgeRoot, id);
  return scanHookFiles(files, def.permissions, def.script);
}

