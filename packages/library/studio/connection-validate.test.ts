/**
 * Acceptance tests for `validateConnections` (R3-04-F1/F4,
 * `_wave5/specs/R3-04.md` D5/D6/D8/D14/D15). Round 6 (adversarial-review
 * FIX FIRST, item 4): `validateConnections` is moving OUT of
 * `orchestrator/studio/validate.ts` (997 lines, over the house 800-line cap
 * — this initiative alone added 131 of them) into its own sibling module
 * `orchestrator/studio/connection-validate.ts`, the SAME discipline the
 * initiative already applied when it extracted `connection-catalog.ts` out
 * of `registry.ts`. This file moved out of `validate.test.ts` to mirror
 * that 1:1 (the house convention throughout this campaign: one test file
 * per production module — `connection-library.test.ts`/`connection-
 * library.ts`, `connection-probe.test.ts`/`connection-probe.ts`, etc.).
 *
 * Splitting this OUT of `validate.test.ts` (rather than merely repointing
 * the import in place) is a deliberate T3 judgment call, not the letter of
 * what was asked: `connection-validate.ts` does not exist yet, so a
 * top-level NAMED import of it is expected to `ERR_MODULE_NOT_FOUND` until
 * the fix lands — exactly the intended round-6 red. Doing that import
 * in-place inside `validate.test.ts` would crash the ENTIRE file at
 * load time, taking down the ~200 unrelated, currently-green tests above
 * this section (agent/flow/catalog/kb/project validation) with it — a
 * regression this campaign's own "test-first honesty" standard forbids
 * introducing as a side effect of an unrelated fix. A dedicated file gets
 * the same real, direct, named import `T2` asked for, with the failure
 * blast radius correctly scoped to exactly the module being tested.
 *
 * Findings use `object: "connection:<id>"`, `check: "connection/<rule>"` —
 * mirrors `validateInstructionSeed`'s per-domain-function precedent, not a
 * bolt-on to `validateCatalog`.
 *
 * Rules covered (eight, each independently an ERROR):
 *   connection/unpinned            — D14: an npm-installable entry's version
 *                                     is not an EXACT pin.
 *   connection/missing-probe       — D3/D4: no probe ⇒ readiness can never be
 *                                     executed for this entry.
 *   connection/missing-install     — round-6 FIX-FIRST finding: an entry
 *                                     with no `install` field at all silently
 *                                     passed lint, then `listConnections()`
 *                                     threw inside its `.map()` — a ONE-FIELD
 *                                     curation typo 500ing the ENTIRE
 *                                     `/api/studio/connections` surface,
 *                                     including every OTHER, perfectly valid
 *                                     entry. Naming/shape mine (mirrors
 *                                     `connection/missing-probe` exactly).
 *   connection/missing-provenance  — same finding, same fix, for `provenance`.
 *   connection/missing-config      — same finding, same fix, for `config`
 *                                     (the KEY being entirely absent —
 *                                     `undefined` — never a legitimately
 *                                     empty `config: []`, which many real
 *                                     entries declare on purpose).
 *   connection/bad-env-name        — D5: a config var's `env` does not match
 *                                     the env-var-NAME shape.
 *   connection/mcp-capabilities    — D8: an mcp entry with zero capabilities.
 *   connection/unknown-config-key  — D5: a config var declares a key outside
 *                                     {env,required,purpose}.
 *   connection/probe-kind-mismatch — D15: probe.kind does not cohere with
 *                                     install.method.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Catalog } from '@forge/contracts/studio/types.ts';
import { validateConnections } from './connection-validate.ts';
import { runStudioLint } from '../../../cli/studio-lint.ts';

// ---------------------------------------------------------------------------
// Fixture helpers (a small local makeCatalog — the shared one in
// validate.test.ts is that file's own private helper, not exported; this
// file duplicates the same 8-line shape rather than importing across two
// .test.ts files, which has no precedent anywhere in this codebase).
// ---------------------------------------------------------------------------

function makeCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: [{ id: 'Read', name: 'Read' }],
    mcps: [],
    guards: [{ id: 'event-log', name: 'Event Log', kind: 'toggle' }],
    path: '/studio/catalog.yaml',
    ...overrides,
  };
}

// ROUND 3 (D13/D15): install is a THREE-method union; probe is a
// KIND-TAGGED union coherent with the install method (npm ⇒ npm-package;
// system-provided ⇒ command; external ⇒ command | command-presence).
type ConnectionConfigVarFixture = { env: string; required: boolean; purpose: string };
type ConnectionInstallFixture =
  | { method: 'system-provided' }
  | { method: 'npm'; package: string; version: string }
  | { method: 'external'; upstream: string };
type ConnectionProbeFixture =
  | { kind: 'command'; command: string; args: string[] }
  | { kind: 'command-presence'; command: string }
  | { kind: 'npm-package' };
type ConnectionCatalogEntryFixture = {
  id: string;
  name: string;
  desc?: string;
  // install/provenance/config are OPTIONAL here (round 6) — matching the
  // REAL, now-landed `CatalogConnectionEntry` type (types.ts) exactly. This
  // is what makes the three new missing-install/missing-provenance/
  // missing-config fixtures below buildable with real types and zero `as
  // unknown as` casts: omitting the key is legitimately well-typed, not a
  // deliberate type-system bypass.
  install?: ConnectionInstallFixture;
  config?: ConnectionConfigVarFixture[];
  probe?: ConnectionProbeFixture;
  provenance?: string;
  capabilities?: Array<{ name: string; summary: string }>;
};

function connCatalog(overrides: { tools?: ConnectionCatalogEntryFixture[]; mcps?: ConnectionCatalogEntryFixture[] }): Catalog {
  return {
    ...makeCatalog(),
    tools: (overrides.tools ?? []) as unknown as Catalog['tools'],
    mcps: (overrides.mcps ?? []) as unknown as Catalog['mcps'],
  };
}

function cleanToolEntry(id = 'git'): ConnectionCatalogEntryFixture {
  return {
    id,
    name: id,
    install: { method: 'system-provided' },
    config: [],
    probe: { kind: 'command', command: id, args: ['--version'] },
    provenance: 'system',
  };
}

/** D16: `memory` (npm-distributed, no required config) is the real
 *  installable example — NOT `sqlite` (external, no npm distribution). */
function cleanMcpEntry(id = 'memory'): ConnectionCatalogEntryFixture {
  return {
    id,
    name: id,
    install: { method: 'npm', package: `@forge-test/${id}`, version: '1.0.0' },
    config: [],
    probe: { kind: 'npm-package' },
    provenance: 'https://example.com',
    capabilities: [{ name: 'query', summary: 'Do the thing.' }],
  };
}

/** D13: the real "no npm distribution" example — an external mcp. */
function cleanExternalMcpEntry(id = 'sqlite'): ConnectionCatalogEntryFixture {
  return {
    id,
    name: id,
    install: { method: 'external', upstream: 'https://pypi.org/project/mcp-server-sqlite/' },
    config: [],
    probe: { kind: 'command-presence', command: `mcp-server-${id}` },
    provenance: 'https://example.com',
    capabilities: [{ name: 'query', summary: 'Do the thing.' }],
  };
}

function connectionFindings(catalog: Catalog): Array<{ level: string; object: string; check: string; message: string }> {
  return validateConnections(catalog);
}

// T2 ruling (round 2, item 5): "unpinned" means NOT AN EXACT VERSION — four
// distinct shapes, each independently an ERROR. A range/`latest` is the
// realistic real-world mistake; if the lint only rejects the empty string,
// the rule is decorative. `install:` itself is a CLOSED two-method
// discriminated union (`system-provided` | `npm`) — an unrecognised method
// value is NOT a `connection/unpinned` lint finding at all, it is a LOAD
// THROW (see `connection-library.test.ts`'s "closed two-value discriminated
// union" describe block, and the `runStudioLint` "unknown install method"
// AT below, which pins that the throw surfaces via `forge studio lint`'s
// EXISTING catalog-load try/catch, not a new bespoke error path).
describe('validateConnections — unpinned installable entry (D6, T2 ruling: 4 shapes)', () => {
  const UNPINNED_VERSIONS: Array<{ label: string; version: unknown }> = [
    { label: 'missing version key entirely', version: undefined },
    { label: 'empty string', version: '' },
    { label: 'a caret range ("^1.2.3")', version: '^1.2.3' },
    { label: 'a tilde range ("~1.2")', version: '~1.2' },
    { label: 'an x-range ("1.x")', version: '1.x' },
    { label: 'a wildcard ("*")', version: '*' },
    { label: 'the "latest" tag', version: 'latest' },
  ];

  for (const { label, version } of UNPINNED_VERSIONS) {
    it(`${label} → error connection/unpinned (a real pin is required, not merely a non-empty string)`, () => {
      const install: Record<string, unknown> = { method: 'npm', package: '@x/y' };
      if (version !== undefined) install['version'] = version;
      const entry = { ...cleanMcpEntry('unpinned-mcp'), install: install as unknown as ConnectionInstallFixture };
      const catalog = connCatalog({ mcps: [entry] });
      const findings = connectionFindings(catalog);
      const f = findings.find((x) => x.check === 'connection/unpinned');
      assert.ok(f, `expected connection/unpinned finding for ${label} (version: ${JSON.stringify(version)})`);
      assert.equal(f!.level, 'error');
      assert.ok(f!.message.includes('unpinned-mcp'));
    });
  }

  it('a system-provided entry is never flagged unpinned (it has no version to pin)', () => {
    const catalog = connCatalog({ tools: [cleanToolEntry('git')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/unpinned'));
  });

  it('a fully-pinned EXACT npm version → no connection/unpinned finding', () => {
    const catalog = connCatalog({ mcps: [cleanMcpEntry('memory')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/unpinned'));
  });

  it('sanity: cleanMcpEntry\'s own fixture pin ("1.0.0") really is exact — a guard against this whole describe block silently testing nothing', () => {
    // Non-null assertions here (not `any`): cleanMcpEntry's OWN object
    // literal always sets `install` — the field is optional only on the
    // SHARED fixture type (so the missing-install tests can omit it), never
    // at this specific call site.
    assert.equal(cleanMcpEntry('x').install!.method, 'npm');
    assert.equal((cleanMcpEntry('x').install as { version: string }).version, '1.0.0');
  });
});

describe('validateConnections — missing probe (D3/D4)', () => {
  it('an entry with no probe field → error connection/missing-probe', () => {
    const { probe: _drop, ...withoutProbe } = cleanToolEntry('no-probe-tool');
    const catalog = connCatalog({ tools: [withoutProbe as ConnectionCatalogEntryFixture] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/missing-probe');
    assert.ok(f, 'expected connection/missing-probe finding');
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('no-probe-tool'));
  });

  it('an entry with a probe → no connection/missing-probe finding', () => {
    const catalog = connCatalog({ tools: [cleanToolEntry('git')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/missing-probe'));
  });
});

// ---------------------------------------------------------------------------
// Round 6 (adversarial-review FIX FIRST, item 3): the reviewer reproduced a
// LIVE production defect from this exact gap. `validateConnectionEntry`
// checked ONLY that `probe` was present — an entry missing `install`,
// `provenance`, or `config` passed lint clean, then `listConnections()`
// threw inside its `.map()`, so `GET /api/studio/connections` (AND every
// OTHER, perfectly-valid entry's detail route) 500ed. One curation typo,
// total blast radius. These three describes mirror `connection/missing-
// probe` exactly, one per field — the fix this pins.
// ---------------------------------------------------------------------------

describe('validateConnections — missing install (round-6 FIX-FIRST: a one-field typo must not 500 the whole API)', () => {
  it('an entry with no install field at all → error connection/missing-install', () => {
    const { install: _drop, ...withoutInstall } = cleanToolEntry('no-install-tool');
    const catalog = connCatalog({ tools: [withoutInstall] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/missing-install');
    assert.ok(f, 'expected connection/missing-install finding');
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('no-install-tool'));
  });

  it('an entry with install → no connection/missing-install finding', () => {
    const catalog = connCatalog({ tools: [cleanToolEntry('git')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/missing-install'));
  });
});

describe('validateConnections — missing provenance (round-6 FIX-FIRST)', () => {
  it('an entry with no provenance field at all → error connection/missing-provenance', () => {
    const { provenance: _drop, ...withoutProvenance } = cleanMcpEntry('no-provenance-mcp');
    const catalog = connCatalog({ mcps: [withoutProvenance] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/missing-provenance');
    assert.ok(f, 'expected connection/missing-provenance finding');
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('no-provenance-mcp'));
  });

  it('an entry with provenance → no connection/missing-provenance finding', () => {
    const catalog = connCatalog({ mcps: [cleanMcpEntry('memory')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/missing-provenance'));
  });
});

describe('validateConnections — missing config (round-6 FIX-FIRST: the KEY absent, never a legitimately empty config: [])', () => {
  it('an entry with no config field at all (undefined, not []) → error connection/missing-config', () => {
    const { config: _drop, ...withoutConfig } = cleanToolEntry('no-config-tool');
    const catalog = connCatalog({ tools: [withoutConfig] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/missing-config');
    assert.ok(f, 'expected connection/missing-config finding');
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('no-config-tool'));
  });

  it('an entry declaring config: [] EXPLICITLY (the real, common, correct shape for e.g. "git") → NO connection/missing-config finding — the KEY is present, just empty', () => {
    const catalog = connCatalog({ tools: [cleanToolEntry('git')] }); // cleanToolEntry sets config: []
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/missing-config'), 'an explicit empty array must never be confused with the key being entirely absent');
  });

  it('an entry with a non-empty config → no connection/missing-config finding', () => {
    const catalog = connCatalog({ mcps: [cleanMcpEntry('memory')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/missing-config'));
  });
});

describe('validateConnections — bad env-var-name shape (D5)', () => {
  it('a config env value not matching ^[A-Z_][A-Z0-9_]*$ → error connection/bad-env-name', () => {
    const entry = cleanMcpEntry('bad-env-mcp');
    entry.config = [{ env: 'not-a-valid-name', required: true, purpose: 'x' }];
    const catalog = connCatalog({ mcps: [entry] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/bad-env-name');
    assert.ok(f, 'expected connection/bad-env-name finding');
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('not-a-valid-name'));
  });

  it('a well-shaped SCREAMING_SNAKE env name → no connection/bad-env-name finding', () => {
    const entry = cleanMcpEntry('good-env-mcp');
    entry.config = [{ env: 'GITHUB_TOKEN', required: true, purpose: 'x' }];
    const catalog = connCatalog({ mcps: [entry] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/bad-env-name'));
  });
});

describe('validateConnections — mcp with zero capabilities (D8)', () => {
  it('an mcp entry with capabilities: [] → error connection/mcp-capabilities', () => {
    const entry = cleanMcpEntry('empty-caps-mcp');
    entry.capabilities = [];
    const catalog = connCatalog({ mcps: [entry] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/mcp-capabilities');
    assert.ok(f, 'expected connection/mcp-capabilities finding');
    assert.equal(f!.level, 'error');
  });

  it('a tool entry with no capabilities at all is NEVER flagged (the rule is mcp-only)', () => {
    const catalog = connCatalog({ tools: [cleanToolEntry('git')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/mcp-capabilities'));
  });

  it('an mcp entry with ≥1 capability → no connection/mcp-capabilities finding', () => {
    const catalog = connCatalog({ mcps: [cleanMcpEntry('memory')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/mcp-capabilities'));
  });
});

// T2 round-3 mandate: probe kind must COHERE with install method (D15) —
// `forge studio lint` errors on a mismatch. Table (D15):
//   npm              ⇒ REQUIRED kind: npm-package
//   system-provided  ⇒ REQUIRED kind: command
//   external         ⇒ kind: command OR command-presence
describe('validateConnections — probe-kind vs install-method coherence (D15, T2 round-3 mandate)', () => {
  it('an npm entry declaring a "command" probe (instead of npm-package) → error connection/probe-kind-mismatch', () => {
    const entry = { ...cleanMcpEntry('npm-with-command-probe'), probe: { kind: 'command' as const, command: 'npx', args: ['--version'] } };
    const catalog = connCatalog({ mcps: [entry] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/probe-kind-mismatch');
    assert.ok(f, 'expected connection/probe-kind-mismatch for an npm entry declaring a non-npm-package probe');
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('npm-with-command-probe'));
  });

  it('an npm entry declaring a "command-presence" probe → error connection/probe-kind-mismatch (still wrong — npm requires npm-package)', () => {
    const entry = { ...cleanMcpEntry('npm-with-presence-probe'), probe: { kind: 'command-presence' as const, command: 'npx' } };
    const catalog = connCatalog({ mcps: [entry] });
    assert.ok(connectionFindings(catalog).some((x) => x.check === 'connection/probe-kind-mismatch'));
  });

  it('a system-provided entry declaring an "npm-package" probe → error connection/probe-kind-mismatch', () => {
    const entry = { ...cleanToolEntry('sys-with-npmpkg-probe'), probe: { kind: 'npm-package' as const } };
    const catalog = connCatalog({ tools: [entry] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/probe-kind-mismatch');
    assert.ok(f, 'expected connection/probe-kind-mismatch for a system-provided entry declaring npm-package');
    assert.ok(f!.message.includes('sys-with-npmpkg-probe'));
  });

  it('a system-provided entry declaring a "command-presence" probe → error connection/probe-kind-mismatch (system-provided REQUIRES command, not presence-only)', () => {
    const entry = { ...cleanToolEntry('sys-with-presence-probe'), probe: { kind: 'command-presence' as const, command: 'git' } };
    const catalog = connCatalog({ tools: [entry] });
    assert.ok(connectionFindings(catalog).some((x) => x.check === 'connection/probe-kind-mismatch'));
  });

  it('an external entry declaring an "npm-package" probe → error connection/probe-kind-mismatch (external is command | command-presence, never npm-package)', () => {
    const entry = { ...cleanExternalMcpEntry('ext-with-npmpkg-probe'), probe: { kind: 'npm-package' as const } };
    const catalog = connCatalog({ mcps: [entry] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/probe-kind-mismatch');
    assert.ok(f, 'expected connection/probe-kind-mismatch for an external entry declaring npm-package');
    assert.ok(f!.message.includes('ext-with-npmpkg-probe'));
  });

  it('an external entry declaring a "command" probe → NO mismatch finding (command IS a valid choice for external)', () => {
    const entry = { ...cleanExternalMcpEntry('ext-with-command-probe'), probe: { kind: 'command' as const, command: 'github-mcp-server', args: ['--version'] } };
    const catalog = connCatalog({ mcps: [entry] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/probe-kind-mismatch'));
  });

  it('an external entry declaring a "command-presence" probe → NO mismatch finding (the other valid choice for external)', () => {
    const catalog = connCatalog({ mcps: [cleanExternalMcpEntry('ext-with-presence-probe')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/probe-kind-mismatch'));
  });

  it('an npm entry declaring the CORRECT npm-package probe → no mismatch finding', () => {
    const catalog = connCatalog({ mcps: [cleanMcpEntry('npm-correct')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/probe-kind-mismatch'));
  });

  it('a system-provided entry declaring the CORRECT command probe → no mismatch finding', () => {
    const catalog = connCatalog({ tools: [cleanToolEntry('sys-correct')] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/probe-kind-mismatch'));
  });
});

describe('validateConnections — unknown config key (D5)', () => {
  it('a config entry declaring a key outside {env,required,purpose} → error connection/unknown-config-key', () => {
    const entry = cleanMcpEntry('extra-key-mcp');
    entry.config = [{ env: 'GITHUB_TOKEN', required: true, purpose: 'x', default: 'sneaky' } as unknown as ConnectionConfigVarFixture];
    const catalog = connCatalog({ mcps: [entry] });
    const f = connectionFindings(catalog).find((x) => x.check === 'connection/unknown-config-key');
    assert.ok(f, 'expected connection/unknown-config-key finding');
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('default'));
  });

  it('a config entry with only env/required/purpose → no connection/unknown-config-key finding', () => {
    const entry = cleanMcpEntry('clean-key-mcp');
    entry.config = [{ env: 'GITHUB_TOKEN', required: true, purpose: 'x' }];
    const catalog = connCatalog({ mcps: [entry] });
    assert.ok(!connectionFindings(catalog).some((x) => x.check === 'connection/unknown-config-key'));
  });
});

describe('validateConnections: a fully-clean connections catalog → zero connection/* findings', () => {
  it('one clean tool + one clean npm mcp + one clean external mcp → []', () => {
    const catalog = connCatalog({ tools: [cleanToolEntry('git')], mcps: [cleanMcpEntry('memory'), cleanExternalMcpEntry('sqlite')] });
    assert.deepEqual(connectionFindings(catalog).filter((f) => f.check.startsWith('connection/')), []);
  });
});

// ---------------------------------------------------------------------------
// The REAL entry point (D6 AC, and the T3 brief's non-negotiable rule): at
// least the unpinned-entry-fails-lint AT must drive the REAL `forge studio
// lint` entry point (`runStudioLint`), not just the rule function in
// isolation — an optional rule the production caller forgets is an inert
// rule, this campaign's most-repeated defect class.
// ---------------------------------------------------------------------------

describe('runStudioLint (REAL entry point): an unpinned installable connection fails the real `forge studio lint`', () => {
  function tmpRoot(): string {
    return mkdtempSync(join(tmpdir(), 'validate-connections-lint-'));
  }

  it('a real forge root whose catalog.yaml declares an unpinned npm mcp entry surfaces connection/unpinned via runStudioLint', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'skills'), { recursive: true });
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      const catalogYaml = `sdks:
  - { id: claude, name: Claude, available: true }
models:
  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet }
tools: []
mcps:
  - id: unpinned-real-lint-mcp
    name: Unpinned Real Lint Mcp
    install: { method: npm, package: "@forge-test/unpinned-real-lint", version: "" }
    config: []
    probe: { kind: npm-package }
    provenance: "https://example.com"
    capabilities:
      - { name: query, summary: "Do the thing." }
guards: []
`;
      writeFileSync(join(root, 'studio', 'catalog.yaml'), catalogYaml, 'utf8');

      const result = runStudioLint(root);
      const hit = result.findings.find((f) => f.check === 'connection/unpinned');
      assert.ok(
        hit,
        `expected runStudioLint to surface a connection/unpinned finding for the unpinned mcp — this AT is legitimately RED until WI-1 wires validateConnections into cli/studio-lint.ts's catalog section. Got findings: ${JSON.stringify(result.findings.map((f) => f.check))}`,
      );
      assert.equal(hit!.level, 'error');
      assert.ok(hit!.message.includes('unpinned-real-lint-mcp'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // T2 ruling (round 2, item 5): install: is a CLOSED two-method
  // discriminated union — an unrecognised method value THROWS at load,
  // surfaced by forge studio lint's ALREADY-SHIPPED catalog try/catch
  // (cli/studio-lint.ts section 3 — `catch (err) { push a 'load' finding }`)
  // — never a bespoke connection/* finding of its own. This is the "closed
  // set, no silent binary/brew/curl escape hatch" acceptance criterion.
  it('an unrecognised install method (e.g. "binary") THROWS at catalog load — surfaced by runStudioLint\'s EXISTING catalog try/catch as a "load" finding, never a fabricated connection/* finding', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'skills'), { recursive: true });
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      const catalogYaml = `sdks:
  - { id: claude, name: Claude, available: true }
models:
  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet }
tools:
  - id: bad-method-tool
    name: Bad Method Tool
    install: { method: binary, url: "https://example.com/bad-method-tool" }
    config: []
    probe: { kind: command, command: bad-method-tool, args: ["--version"] }
    provenance: "https://example.com"
guards: []
`;
      writeFileSync(join(root, 'studio', 'catalog.yaml'), catalogYaml, 'utf8');

      const result = runStudioLint(root);
      const loadFinding = result.findings.find((f) => f.object === 'studio:catalog' && f.check === 'load');
      assert.ok(
        loadFinding,
        `expected a studio:catalog "load" finding for the unrecognised install method — this AT is legitimately RED until WI-1's connection catalog parser throws on an unknown method. Got findings: ${JSON.stringify(result.findings.map((f) => `${f.object}:${f.check}`))}`,
      );
      assert.equal(loadFinding!.level, 'error');
      // A "binary" download method is DELIBERATELY not built (T2 ruling: it
      // would need a checksum/verification story nothing in the curated set
      // needs) — this must never quietly succeed as though it were a third
      // supported install method.
      assert.ok(!result.findings.some((f) => f.check.startsWith('connection/')), 'a structurally-invalid entry must never ALSO produce a fabricated connection/* finding alongside the load error');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Round 6 (adversarial-review FIX FIRST, item 3): drives the REAL
  // runStudioLint entry point for the missing-install/provenance/config
  // gap — the SAME "an optional rule the production caller forgets is an
  // inert rule" non-negotiable this file's header already states for
  // connection/unpinned. One real catalog.yaml, one entry missing BOTH
  // install and provenance simultaneously (the realistic shape of "someone
  // pasted a template and forgot to fill two fields in"), alongside a
  // perfectly clean sibling entry — proving the clean sibling is NOT
  // silently swallowed by the same load pass that flags the broken one.
  it('a real forge root whose catalog.yaml has an entry missing install AND provenance surfaces BOTH findings via runStudioLint, without losing the clean sibling entry', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'skills'), { recursive: true });
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      const catalogYaml = `sdks:
  - { id: claude, name: Claude, available: true }
models:
  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet }
tools:
  - id: missing-install-and-provenance-tool
    name: Missing Install And Provenance Tool
    config: []
    probe: { kind: command, command: missing-install-and-provenance-tool, args: ["--version"] }
  - id: clean-sibling-tool
    name: Clean Sibling Tool
    install: { method: system-provided }
    config: []
    probe: { kind: command, command: clean-sibling-tool, args: ["--version"] }
    provenance: "https://example.com"
mcps: []
guards: []
`;
      writeFileSync(join(root, 'studio', 'catalog.yaml'), catalogYaml, 'utf8');

      const result = runStudioLint(root);
      const missingInstall = result.findings.find((f) => f.check === 'connection/missing-install');
      const missingProvenance = result.findings.find((f) => f.check === 'connection/missing-provenance');
      assert.ok(
        missingInstall,
        `expected a connection/missing-install finding — this AT is legitimately RED until the fix lands. Got findings: ${JSON.stringify(result.findings.map((f) => f.check))}`,
      );
      assert.ok(missingProvenance, 'expected a connection/missing-provenance finding for the SAME broken entry');
      assert.equal(missingInstall!.level, 'error');
      assert.equal(missingProvenance!.level, 'error');
      assert.ok(missingInstall!.message.includes('missing-install-and-provenance-tool'));
      assert.ok(
        !result.findings.some((f) => f.object === 'connection:clean-sibling-tool'),
        'the clean sibling entry must surface ZERO findings — a curation typo on one entry must never taint another',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
