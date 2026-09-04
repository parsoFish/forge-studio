/**
 * Connection catalog lint rules (R3-04-F1/F4, `_wave5/specs/R3-04.md`
 * D5/D6/D8/D14/D15).
 *
 * Round-6 adversarial-review FIX-FIRST (MAJOR item 3): extracted out of
 * `orchestrator/studio/validate.ts` — that file was 997 lines against the
 * house 800-line hard cap and this initiative alone added 131 of them. Same
 * discipline already applied when `connection-catalog.ts` was extracted out
 * of `registry.ts`.
 *
 * Kept a dependency-free leaf, mirroring `validate-triggers.ts`'s own local
 * `err()`/`*Finding` pattern rather than importing `Finding`/`err` from
 * `validate.ts` — this module only needs `Catalog`/`CatalogConnectionEntry`
 * from `types.ts`, so there is no risk of a validate.ts↔connection-
 * validate.ts import cycle (`ConnectionFinding`'s shape is structurally
 * identical to `Finding`, so `findings.push(...validateConnections(catalog))`
 * in `apps/forge/studio-lint.ts` still type-checks with no cast).
 *
 * Scans BOTH catalog.tools and catalog.mcps (a connection IS a tools/mcps
 * entry — D2's "no third kind" ruling). Findings use `object:
 * "connection:<id>"`, `check: "connection/<rule>"` — a single-purpose
 * function per domain, matching validateInstructionSeed/
 * validateDiscoveredProjects's existing shape, not a bolt-on to
 * validateCatalog.
 *
 * Nine rules, each independently an ERROR (never a flag — every one of these
 * is a real operational hazard: an unpinned install is non-reproducible, a
 * missing probe means readiness can never be executed, a missing
 * install/provenance/config field crashes `listConnections()` at read time
 * (round-6's reproduced defect — see below), a bad env-var name is silently
 * never satisfiable, zero capabilities reads as a fabricated "no
 * capabilities", an unknown config key is a typo nobody will notice, and a
 * probe/install mismatch fabricates a signal — D15):
 *
 *   connection/unpinned            — D14: an npm-installable entry's version
 *                                     is not an EXACT pin (missing, empty, a
 *                                     range, or "latest").
 *   connection/missing-probe       — D3/D4: no probe ⇒ readiness can never be
 *                                     executed for this entry.
 *   connection/missing-install     — round-6 FIX-FIRST: `validateConnectionEntry`
 *                                     used to check ONLY that `probe` was
 *                                     present. An entry missing `install`
 *                                     passed lint clean, then
 *                                     `listConnections()` threw inside its
 *                                     `.map()` — a ONE-FIELD curation typo
 *                                     500ing `GET /api/studio/connections`
 *                                     for every OTHER, perfectly valid entry
 *                                     too. Mirrors connection/missing-probe.
 *   connection/missing-provenance  — same finding, same fix, for `provenance`.
 *   connection/missing-config      — same finding, same fix, for `config` —
 *                                     the KEY being entirely absent
 *                                     (`undefined`), never a legitimately
 *                                     empty `config: []`, which many real
 *                                     entries declare on purpose.
 *   connection/bad-env-name        — D5: a config var's `env` does not match
 *                                     the env-var-NAME shape.
 *   connection/mcp-capabilities    — D8: an mcp entry with zero capabilities.
 *   connection/unknown-config-key  — D5: a config var declares a key outside
 *                                     {env,required,purpose}.
 *   connection/probe-kind-mismatch — D15: probe.kind does not cohere with
 *                                     install.method (npm⇒npm-package,
 *                                     system-provided⇒command,
 *                                     external⇒command|command-presence).
 */

import type { Catalog, CatalogConnectionEntry } from '@forge/contracts/studio/types.ts';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type ConnectionFinding = {
  level: 'error' | 'flag';
  object: string;
  check: string;
  message: string;
};

function err(object: string, check: string, message: string): ConnectionFinding {
  return { level: 'error', object, check, message };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CONNECTION_ALLOWED_CONFIG_KEYS = new Set(['env', 'required', 'purpose']);
const CONNECTION_ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/** D14: "pinned" means an EXACT version — missing, empty, a semver RANGE
 *  (`^`/`~`/wildcard), or the "latest" tag are all realistic mistakes, not
 *  merely the empty-string case (a rule that only rejects "" is decorative). */
function isUnpinnedVersion(version: unknown): boolean {
  if (typeof version !== 'string' || version.trim() === '') return true;
  if (version === 'latest') return true;
  if (/[\^~*]/.test(version)) return true;
  if (/(^|\.)[xX](\.|$)/.test(version)) return true; // "1.x" / "1.X.2" wildcard segment
  return false;
}

function connectionProbeKindRequirement(method: string): string {
  if (method === 'npm') return 'npm-package';
  if (method === 'system-provided') return 'command';
  return 'command|command-presence';
}

function connectionProbeKindCoheres(method: string, probeKind: string): boolean {
  if (method === 'npm') return probeKind === 'npm-package';
  if (method === 'system-provided') return probeKind === 'command';
  if (method === 'external') return probeKind === 'command' || probeKind === 'command-presence';
  return true; // an unrecognised method is a load-throw concern, never reached here
}

function validateConnectionEntry(entry: CatalogConnectionEntry, kind: 'tool' | 'mcp'): ConnectionFinding[] {
  const findings: ConnectionFinding[] = [];
  const obj = `connection:${entry.id}`;

  // Round-6 FIX-FIRST: install/provenance/config presence, mirroring
  // connection/missing-probe exactly. These three checks must run BEFORE the
  // unpinned/probe-kind-mismatch checks below narrow on `entry.install`
  // being defined — a missing field is reported once, here, not silently
  // skipped by those narrower checks.
  if (entry.install === undefined) {
    findings.push(
      err(
        obj,
        'connection/missing-install',
        `Connection "${entry.id}" declares no install method — listConnections() requires one on every entry (a curation typo here 500s the whole /api/studio/connections surface); declare "system-provided", "npm", or "external" (D13)`,
      ),
    );
  }

  if (entry.provenance === undefined) {
    findings.push(
      err(
        obj,
        'connection/missing-provenance',
        `Connection "${entry.id}" declares no provenance — every connection must record its upstream source`,
      ),
    );
  }

  if (entry.config === undefined) {
    findings.push(
      err(
        obj,
        'connection/missing-config',
        `Connection "${entry.id}" declares no config field — an entry with no required env vars must still declare "config: []" explicitly; the key must never be entirely absent`,
      ),
    );
  }

  if (entry.install !== undefined && entry.install.method === 'npm') {
    const version = (entry.install as { version?: unknown }).version;
    if (isUnpinnedVersion(version)) {
      findings.push(
        err(
          obj,
          'connection/unpinned',
          `Connection "${entry.id}" is npm-installable but its version is not an exact pin (got ${JSON.stringify(version)}) — install.version must be an exact version, never missing, empty, a range, or "latest" (D14)`,
        ),
      );
    }
  }

  if (entry.probe === undefined) {
    findings.push(
      err(obj, 'connection/missing-probe', `Connection "${entry.id}" declares no probe — readiness is EXECUTED per entry, never declared, so every connection must carry one (D3)`),
    );
  }

  for (const cfg of entry.config ?? []) {
    const raw = cfg as unknown as Record<string, unknown>;
    const env = raw['env'];
    if (typeof env !== 'string' || !CONNECTION_ENV_NAME_RE.test(env)) {
      findings.push(
        err(obj, 'connection/bad-env-name', `Connection "${entry.id}" config env ${JSON.stringify(env)} does not match ${CONNECTION_ENV_NAME_RE} (env-var names must be SCREAMING_SNAKE_CASE)`),
      );
    }
    for (const key of Object.keys(raw)) {
      if (!CONNECTION_ALLOWED_CONFIG_KEYS.has(key)) {
        findings.push(
          err(obj, 'connection/unknown-config-key', `Connection "${entry.id}" config entry declares unknown key "${key}" — allowed keys are env|required|purpose (D5: a config var never carries a value field)`),
        );
      }
    }
  }

  if (kind === 'mcp' && (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0)) {
    findings.push(
      err(obj, 'connection/mcp-capabilities', `MCP connection "${entry.id}" declares zero capabilities — an empty list must never render as an honest "no capabilities" (D8)`),
    );
  }

  if (entry.install !== undefined && entry.probe !== undefined) {
    const method = entry.install.method;
    const probeKind = entry.probe.kind;
    if (!connectionProbeKindCoheres(method, probeKind)) {
      findings.push(
        err(
          obj,
          'connection/probe-kind-mismatch',
          `Connection "${entry.id}" install method "${method}" requires probe kind ${connectionProbeKindRequirement(method)}, got "${probeKind}" (D15)`,
        ),
      );
    }
  }

  return findings;
}

export function validateConnections(c: Catalog): ConnectionFinding[] {
  return [
    ...c.tools.flatMap((e) => validateConnectionEntry(e, 'tool')),
    ...c.mcps.flatMap((e) => validateConnectionEntry(e, 'mcp')),
  ];
}
