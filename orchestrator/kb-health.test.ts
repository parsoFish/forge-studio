/**
 * R4-09-F4/F5 — post-cycle KB health dispatcher tests.
 *
 * Covers touched-KB detection (fresh themes + always-cycles), per-KB
 * ingest/consolidate/lint dispatch + events, the cmd-shaped process invocation
 * contract, and the F4 routing claim (project-subject vs flow-subject writes
 * land in distinct KBs and are health-checked separately).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPostReflectionKbHealth, type KbHealthDeps } from './kb-health.ts';
import type { EventLogEntry, EventLogger } from './logging.ts';
import type { Finding } from '../cli/brain-lint.ts';

function kbYaml(id: string, binding: string): string {
  return [`id: ${id}`, `name: ${id} KB`, `binding:`, `  ${binding}`, `desc: test kb`, ''].join('\n');
}

/** A tmp forge root with the three-brain layout + a kb.yaml per brain. */
function setupBrain(): { forgeRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'kbhealth-'));
  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'cycles', '_raw'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'kb.yaml'), kbYaml('cycles', 'kind: flow\n  ref: forge-develop'));
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'kb.yaml'), kbYaml('forge-dev', 'kind: unique'));
  writeFileSync(join(forgeRoot, 'brain', 'projects', 'demo', 'kb.yaml'), kbYaml('demo', 'kind: project\n  ref: demo'));
  return { forgeRoot };
}

/** Write a theme and stamp its mtime to `atMs`. */
function writeTheme(dir: string, name: string, atMs: number): void {
  const p = join(dir, name);
  writeFileSync(p, `---\ntitle: ${name}\n---\nbody\n`);
  const s = atMs / 1000;
  utimesSync(p, s, s);
}

function fakeLogger(events: EventLogEntry[]): EventLogger {
  return { emit: (e: EventLogEntry) => { events.push(e); return e; }, logFilePath: 'x' } as unknown as EventLogger;
}

/** Deps that stub the shared builtins so tests stay fast + fs-light. */
function stubDeps(overrides: Partial<KbHealthDeps> = {}): { deps: KbHealthDeps; regenCount: () => number; autoFixCalls: () => number } {
  let regen = 0;
  let fixes = 0;
  const deps: KbHealthDeps = {
    regenerateBrainIndex: () => { regen += 1; },
    runBrainLint: () => ({ findings: [] as Finding[], exitCode: 0 }),
    applyAutoFixes: () => { fixes += 1; return { applied: [], skipped: [] }; },
    ...overrides,
  };
  return { deps, regenCount: () => regen, autoFixCalls: () => fixes };
}

const START = 1_000_000_000_000; // fixed base ms

test('kb-health: fresh project + cycles themes → both KBs processed, index regenerated once', () => {
  const { forgeRoot } = setupBrain();
  // fresh (after start) themes in project + cycles
  writeTheme(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), '2026-07-25-demo-lesson.md', START + 5000);
  writeTheme(join(forgeRoot, 'brain', 'cycles', 'themes'), '2026-07-25-flow-lesson.md', START + 5000);
  const events: EventLogEntry[] = [];
  const { deps, regenCount } = stubDeps();

  const result = runPostReflectionKbHealth({
    forgeRoot,
    cycleId: 'CID',
    candidateKbIds: ['cycles', 'forge-dev', 'demo'],
    sinceMs: START,
    logger: fakeLogger(events),
    initiativeId: 'INIT',
    deps,
  });

  const kbIds = result.kbs.map((k) => k.kbId).sort();
  assert.deepEqual(kbIds, ['cycles', 'demo'], 'processes cycles (always) + demo (fresh); forge-dev has no fresh theme');
  // index regenerated once, shared across KBs
  assert.equal(regenCount(), 1, 'ingest regenerates the index exactly once across KBs');
  assert.equal(events.filter((e) => e.message === 'reflector.brain-index-regenerated').length, 1);
  // per-KB health events for both processed KBs
  const healthKbs = events.filter((e) => e.message === 'reflect.kb-health').map((e) => e.metadata?.kb).sort();
  assert.deepEqual(healthKbs, ['cycles', 'demo']);
  // each processed KB reports clean lint (no findings stubbed)
  assert.ok(result.kbs.every((k) => k.lint === 'clean' && k.ingest === 'done' && k.consolidate === 'done'));
});

test('kb-health: cycles is processed even with zero fresh themes (archive lands there)', () => {
  const { forgeRoot } = setupBrain();
  // no fresh themes anywhere
  const events: EventLogEntry[] = [];
  const { deps } = stubDeps();
  const result = runPostReflectionKbHealth({
    forgeRoot, cycleId: 'CID', candidateKbIds: ['cycles', 'forge-dev', 'demo'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT', deps,
  });
  assert.deepEqual(result.kbs.map((k) => k.kbId), ['cycles'], 'only cycles (always) processed');
  assert.equal(result.kbs[0].freshThemes, 0);
});

test('kb-health: F4 routing — project vs flow themes attributed to distinct KBs', () => {
  const { forgeRoot } = setupBrain();
  writeTheme(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), 'proj.md', START + 5000);
  writeTheme(join(forgeRoot, 'brain', 'forge-dev', 'themes'), 'decision.md', START + 5000);
  const events: EventLogEntry[] = [];
  const { deps } = stubDeps();
  const result = runPostReflectionKbHealth({
    forgeRoot, cycleId: 'CID', candidateKbIds: ['cycles', 'forge-dev', 'demo'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT', deps,
  });
  const byId = new Map(result.kbs.map((k) => [k.kbId, k]));
  assert.equal(byId.get('demo')?.freshThemes, 1, 'project-subject lesson → project KB');
  assert.equal(byId.get('forge-dev')?.freshThemes, 1, 'forge-engineering lesson → forge-dev KB');
  assert.ok(byId.has('cycles'), 'cycles always processed');
});

test('kb-health: consolidate auto-fix runs on a KB with fixable findings', () => {
  const { forgeRoot } = setupBrain();
  const themePath = join(forgeRoot, 'brain', 'cycles', 'themes', 'flag.md');
  writeTheme(join(forgeRoot, 'brain', 'cycles', 'themes'), 'flag.md', START + 5000);
  let fixCalls = 0;
  const finding = { file: themePath, category: 'auto-fix', kind: 'index.not-listed', resolution: 'auto' } as unknown as Finding;
  const deps: KbHealthDeps = {
    regenerateBrainIndex: () => {},
    runBrainLint: () => ({ findings: [finding], exitCode: 1 }),
    applyAutoFixes: (_root, findings) => { fixCalls += 1; assert.equal(findings.length, 1, 'only the cycles-KB finding is passed'); return { applied: [{ kind: 'index.not-listed', file: themePath, detail: 'linked' }], skipped: [] }; },
  };
  const events: EventLogEntry[] = [];
  runPostReflectionKbHealth({
    forgeRoot, cycleId: 'CID', candidateKbIds: ['cycles'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT', deps,
  });
  assert.ok(fixCalls >= 1, 'consolidate invoked applyAutoFixes with the KB findings');
  const consolidate = events.find((e) => e.message === 'reflect.kb-consolidate');
  assert.equal(consolidate?.metadata?.applied, 1);
});

test('kb-health: cmd-shaped process gets the R1-01 invocation contract (KB root, run id, raw dir)', () => {
  const { forgeRoot } = setupBrain();
  writeTheme(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), 'p.md', START + 5000);
  const seen: Array<{ cmd: string; kbRoot: string; runId: string; rawDir: string }> = [];
  const deps: KbHealthDeps = {
    regenerateBrainIndex: () => {},
    runBrainLint: () => ({ findings: [], exitCode: 0 }),
    applyAutoFixes: () => ({ applied: [], skipped: [] }),
    // a descriptor for 'demo' declaring cmd-shaped lint
    loadKbDescriptor: () => ({
      id: 'demo', name: 'demo', binding: { kind: 'project', ref: 'demo' }, desc: 'x',
      processes: {
        lint: { cmd: 'my-linter --strict' },
        ingest: { builtin: 'reflector-ingest' },
        consolidate: { builtin: 'brain-fix' },
        usage: { readSurface: 'navigation-index', readers: ['reflector'] },
      },
    }) as never,
    runCmdProcess: (cmd, ctx) => { seen.push({ cmd, kbRoot: ctx.kbRoot, runId: ctx.runId, rawDir: ctx.rawDir }); return 0; },
  };
  const events: EventLogEntry[] = [];
  runPostReflectionKbHealth({
    forgeRoot, cycleId: 'RUN-1', candidateKbIds: ['demo'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT', deps,
  });
  const lintCmd = seen.find((s) => s.cmd === 'my-linter --strict');
  assert.ok(lintCmd, 'the declared cmd lint ran');
  assert.equal(lintCmd!.runId, 'RUN-1', 'run id threaded');
  assert.ok(lintCmd!.kbRoot.endsWith(join('brain', 'projects', 'demo')), 'KB root is the brain dir');
  assert.ok(lintCmd!.rawDir.endsWith(join('brain', 'cycles', '_raw')), 'raw-material dir threaded');
});
