/**
 * Tests for forge-ui/lib/connection-client.ts (R3-04-F2/F3) — DOES NOT EXIST
 * YET. Vitest cannot even collect this file until it lands (module-not-found
 * is the expected red, mirroring hook-client.test.ts's own header note).
 *
 * connection-client.ts mirrors hook-client.ts's role — client-side fetch
 * helpers + types for the `/api/studio/connections*` bridge routes (see
 * cli/bridge-studio-connections.ts's own header for the transport shapes).
 *
 * Tests ONLY the pure `parseConnection` function — no fetch, no window, no
 * jsdom (this repo's forge-ui vitest config is `environment: 'node'` with no
 * DOM, a standing decision — `resolveBridgeUrl()` requires `window`, which
 * does not exist under plain node; the over-the-wire behaviour is pinned by
 * cli/bridge-studio-connections.test.ts instead).
 *
 * `parseConnection` is EXPORTED (not private) for the same reason
 * hook-client.ts exports `parseHookLibraryEntry`/`parseHookDetail`: the
 * `Array.isArray(x) ? x : []` permissive-parse shape (skill-client.ts's
 * original bug — a malformed/missing array silently became a confident
 * empty answer) must never recur here. Every parser below REFUSES (throws)
 * on a malformed payload rather than coercing it.
 */
import { test, expect } from 'vitest';
import { parseConnection } from './connection-client.ts';

const WELL_FORMED_TOOL = {
  id: 'git',
  name: 'git',
  desc: 'Worktrees, branches, commits.',
  kind: 'tool',
  installable: false,
  install: { method: 'system-provided' },
  config: [],
  probe: { state: 'available' },
  provenance: 'system',
  usedBy: ['developer-ralph'],
  usedByDerivation: { source: 'skills/*/SKILL.md (composition.tools + composition.mcps)', scanned: 12 },
};

// D16: memory (npm-distributed, no required config) is the real installable
// round-trip example — NOT sqlite (D13: external, no npm distribution).
const WELL_FORMED_MCP = {
  id: 'memory',
  name: 'Memory',
  desc: 'A persistent knowledge graph the agent can read + write across turns.',
  kind: 'mcp',
  installable: true,
  install: { method: 'npm', package: '@modelcontextprotocol/server-memory', version: '2026.7.4' },
  config: [{ env: 'MEMORY_FILE_PATH', required: false, purpose: 'Where to persist the graph.' }],
  probe: { state: 'misconfigured', exitCode: 1, stdout: '', stderr: 'no db', missingConfig: [] },
  provenance: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  capabilities: [{ name: 'create_entities', summary: 'Create graph entities.' }],
  capabilitiesSource: 'curated',
  usedBy: [],
  usedByDerivation: { source: 'skills/*/SKILL.md (composition.tools + composition.mcps)', scanned: 5 },
};

// D13: sqlite is the real "no npm distribution" example — installable:false,
// install.method:'external' carrying an upstream URL, no package/version.
const WELL_FORMED_EXTERNAL_MCP = {
  id: 'sqlite',
  name: 'SQLite',
  desc: 'Query + mutate a local SQLite database (archived upstream — no npm distribution).',
  kind: 'mcp',
  installable: false,
  install: { method: 'external', upstream: 'https://pypi.org/project/mcp-server-sqlite/' },
  config: [],
  probe: { state: 'not-installed' },
  provenance: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite',
  capabilities: [{ name: 'read_query', summary: 'Run a read-only SQL query.' }],
  capabilitiesSource: 'curated',
  usedBy: [],
  usedByDerivation: { source: 'skills/*/SKILL.md (composition.tools + composition.mcps)', scanned: 5 },
};

test('parseConnection: a well-formed tool entry round-trips every field verbatim', () => {
  expect(parseConnection(WELL_FORMED_TOOL)).toEqual(WELL_FORMED_TOOL);
});

test('parseConnection: a well-formed mcp entry (with capabilities) round-trips every field verbatim', () => {
  expect(parseConnection(WELL_FORMED_MCP)).toEqual(WELL_FORMED_MCP);
});

test('parseConnection: capabilities/capabilitiesSource are legitimately absent on a tool entry — stay undefined, never defaulted to []', () => {
  const parsed = parseConnection(WELL_FORMED_TOOL);
  expect(parsed.capabilities).toBeUndefined();
  expect(parsed.capabilitiesSource).toBeUndefined();
});

test('parseConnection: kind outside {tool, mcp} THROWS — never coerced to a guessed kind', () => {
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, kind: 'cli' })).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, kind: undefined })).toThrow();
});

test('parseConnection: probe.state outside {not-installed, available, misconfigured} THROWS', () => {
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, probe: { state: 'unknown-state' } })).toThrow();
});

test('parseConnection: probe missing or non-object THROWS — never defaulted to {state:"not-installed"}', () => {
  const { probe: _drop, ...missing } = WELL_FORMED_TOOL as Record<string, unknown>;
  expect(() => parseConnection(missing)).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, probe: 'not-an-object' })).toThrow();
});

test('parseConnection: usedBy missing or non-array THROWS — never silently coerced to [] (the empty-vs-unknown distinction)', () => {
  const { usedBy: _drop, ...missing } = WELL_FORMED_TOOL as Record<string, unknown>;
  expect(() => parseConnection(missing)).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, usedBy: 'not-an-array' })).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, usedBy: null })).toThrow();
});

test('parseConnection: usedByDerivation missing, non-object, or with a wrong-typed field THROWS', () => {
  const { usedByDerivation: _drop, ...missing } = WELL_FORMED_TOOL as Record<string, unknown>;
  expect(() => parseConnection(missing)).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, usedByDerivation: { source: 'x' } })).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, usedByDerivation: { source: 1, scanned: 2 } })).toThrow();
});

test('parseConnection: a config entry with a non-string env, non-boolean required, or non-string purpose THROWS', () => {
  expect(() => parseConnection({ ...WELL_FORMED_MCP, config: [{ env: 1, required: true, purpose: 'x' }] })).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_MCP, config: [{ env: 'X', required: 'yes', purpose: 'x' }] })).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_MCP, config: [{ env: 'X', required: true, purpose: 5 }] })).toThrow();
});

test('parseConnection: config missing or non-array THROWS — never defaulted to []', () => {
  const { config: _drop, ...missing } = WELL_FORMED_TOOL as Record<string, unknown>;
  expect(() => parseConnection(missing)).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, config: 'nope' })).toThrow();
});

test('parseConnection: install with an unrecognised method THROWS — the closed set is exactly THREE (D13, round 3)', () => {
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, install: { method: 'brew' } })).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, install: { method: 'binary', url: 'x' } })).toThrow();
});

test('parseConnection: an npm install missing package/version THROWS', () => {
  expect(() => parseConnection({ ...WELL_FORMED_MCP, install: { method: 'npm', package: 'x' } })).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_MCP, install: { method: 'npm', version: '1.0.0' } })).toThrow();
});

test('parseConnection: D13 — an "external" entry round-trips {method, upstream} verbatim, and installable:false is preserved (never coerced to true)', () => {
  const parsed = parseConnection(WELL_FORMED_EXTERNAL_MCP);
  expect(parsed).toEqual(WELL_FORMED_EXTERNAL_MCP);
  expect(parsed.installable).toBe(false);
  expect(parsed.install).toEqual({ method: 'external', upstream: 'https://pypi.org/project/mcp-server-sqlite/' });
});

test('parseConnection: an "external" install missing its required "upstream" field THROWS', () => {
  expect(() => parseConnection({ ...WELL_FORMED_EXTERNAL_MCP, install: { method: 'external' } })).toThrow();
});

test('parseConnection: installable missing or non-boolean THROWS — never defaulted to false', () => {
  const { installable: _drop, ...missing } = WELL_FORMED_TOOL as Record<string, unknown>;
  expect(() => parseConnection(missing)).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, installable: 'yes' })).toThrow();
});

test('parseConnection: capabilitiesSource present but not exactly "curated" THROWS — never a laundered "verified" label', () => {
  expect(() => parseConnection({ ...WELL_FORMED_MCP, capabilitiesSource: 'verified' })).toThrow();
});

test('parseConnection: not a plain object (array, null, string, number) THROWS', () => {
  expect(() => parseConnection(null)).toThrow();
  expect(() => parseConnection([])).toThrow();
  expect(() => parseConnection('nope')).toThrow();
  expect(() => parseConnection(42)).toThrow();
});

test('parseConnection: provenance missing or non-string THROWS', () => {
  const { provenance: _drop, ...missing } = WELL_FORMED_TOOL as Record<string, unknown>;
  expect(() => parseConnection(missing)).toThrow();
  expect(() => parseConnection({ ...WELL_FORMED_TOOL, provenance: 5 })).toThrow();
});
