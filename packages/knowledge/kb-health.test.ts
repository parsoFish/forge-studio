/**
 * R4-09-F4/F5 — post-cycle KB health dispatcher tests.
 *
 * Covers touched-KB detection (fresh themes + always-cycles), per-KB
 * ingest/consolidate/lint dispatch + events, the REAL project-aware structural
 * lint (a broken project theme must come back `flagged`, not a vacuous
 * `clean` — the declared-data-fails-open finding), the cmd-shaped process
 * invocation contract + its `failed` status on non-zero exit, and the F4
 * routing claim (project-subject vs flow-subject writes land in distinct KBs).
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
function writeTheme(dir: string, name: string, atMs: number, body?: string): void {
  const p = join(dir, name);
  writeFileSync(p, body ?? `---\ntitle: ${name}\n---\nbody\n`);
  const s = atMs / 1000;
  utimesSync(p, s, s);
}

/** A structurally valid theme (all required frontmatter, valid category). */
function validThemeBody(): string {
  return ['---', 'title: Valid Theme', 'description: a valid theme', 'category: pattern', 'created_at: 2026-07-25', 'updated_at: 2026-07-25', '---', 'body', ''].join('\n');
}

function fakeLogger(events: EventLogEntry[]): EventLogger {
  return { emit: (e: EventLogEntry) => { events.push(e); return e; }, logFilePath: 'x' } as unknown as EventLogger;
}

/** Deps that stub the shared builtins so tests stay fast + fs-light. */
function stubDeps(overrides: Partial<KbHealthDeps> = {}): { deps: KbHealthDeps; regenCount: () => number } {
  let regen = 0;
  const deps: KbHealthDeps = {
    regenerateBrainIndex: () => { regen += 1; },
    lintThemeFiles: () => [] as Finding[],
    applyAutoFixes: () => ({ applied: [], skipped: [] }),
    ...overrides,
  };
  return { deps, regenCount: () => regen };
}

const START = 1_000_000_000_000; // fixed base ms

test('kb-health: fresh project + cycles themes → both KBs processed, index regenerated once', () => {
  const { forgeRoot } = setupBrain();
  writeTheme(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), '2026-07-25-demo-lesson.md', START + 5000);
  writeTheme(join(forgeRoot, 'brain', 'cycles', 'themes'), '2026-07-25-flow-lesson.md', START + 5000);
  const events: EventLogEntry[] = [];
  const { deps, regenCount } = stubDeps();

  const result = runPostReflectionKbHealth({
    forgeRoot, cycleId: 'CID', candidateKbIds: ['cycles', 'forge-dev', 'demo'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT', deps,
  });

  const kbIds = result.kbs.map((k) => k.kbId).sort();
  assert.deepEqual(kbIds, ['cycles', 'demo'], 'processes cycles (always) + demo (fresh); forge-dev has no fresh theme');
  assert.equal(regenCount(), 1, 'ingest regenerates the index exactly once across KBs');
  assert.equal(events.filter((e) => e.message === 'reflector.brain-index-regenerated').length, 1);
  const healthKbs = events.filter((e) => e.message === 'reflect.kb-health').map((e) => e.metadata?.kb).sort();
  assert.deepEqual(healthKbs, ['cycles', 'demo']);
  assert.ok(result.kbs.every((k) => k.lint === 'clean' && k.ingest === 'done' && k.consolidate === 'done'));
});

test('kb-health: cycles is processed even with zero fresh themes (archive lands there)', () => {
  const { forgeRoot } = setupBrain();
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

test('kb-health: REAL lint (no stub) flags a broken PROJECT theme — not a vacuous clean', () => {
  const { forgeRoot } = setupBrain();
  // A fresh project theme MISSING required frontmatter (no description/category/dates).
  writeTheme(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), 'broken.md', START + 5000, '---\ntitle: only a title\n---\nbody\n');
  const events: EventLogEntry[] = [];
  // Only stub the index regen (fs side effect) — lintThemeFiles + applyAutoFixes are REAL.
  const result = runPostReflectionKbHealth({
    forgeRoot, cycleId: 'CID', candidateKbIds: ['cycles', 'demo'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT',
    deps: { regenerateBrainIndex: () => {} },
  });
  const demo = result.kbs.find((k) => k.kbId === 'demo');
  assert.equal(demo?.lint, 'flagged', 'a broken project theme must surface as flagged, not clean');
});

test('kb-health: REAL lint (no stub) reports a valid PROJECT theme as clean', () => {
  const { forgeRoot } = setupBrain();
  writeTheme(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), 'valid.md', START + 5000, validThemeBody());
  const events: EventLogEntry[] = [];
  const result = runPostReflectionKbHealth({
    forgeRoot, cycleId: 'CID', candidateKbIds: ['demo'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT',
    deps: { regenerateBrainIndex: () => {} },
  });
  const demo = result.kbs.find((k) => k.kbId === 'demo');
  assert.equal(demo?.lint, 'clean', 'a structurally valid project theme is clean (index-sync is a non-gating flag)');
});

test('kb-health: consolidate auto-fix runs on a KB with fixable findings', () => {
  const { forgeRoot } = setupBrain();
  const themePath = join(forgeRoot, 'brain', 'cycles', 'themes', 'flag.md');
  writeTheme(join(forgeRoot, 'brain', 'cycles', 'themes'), 'flag.md', START + 5000);
  let fixCalls = 0;
  const finding = { file: themePath, category: 'auto-fix', kind: 'index.not-listed', resolution: 'auto', check: 'checkIndexSync', message: 'not listed' } as unknown as Finding;
  const deps: KbHealthDeps = {
    regenerateBrainIndex: () => {},
    lintThemeFiles: () => [finding],
    applyAutoFixes: (_root, findings) => { fixCalls += 1; assert.ok(findings.length >= 1, 'the KB findings are passed to auto-fix'); return { applied: [{ kind: 'index.not-listed', file: themePath, detail: 'linked' }], skipped: [] }; },
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
    lintThemeFiles: () => [],
    applyAutoFixes: () => ({ applied: [], skipped: [] }),
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

test('kb-health: a cmd-shaped process that exits non-zero surfaces as failed, not done', () => {
  const { forgeRoot } = setupBrain();
  writeTheme(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), 'p.md', START + 5000);
  const deps: KbHealthDeps = {
    regenerateBrainIndex: () => {},
    lintThemeFiles: () => [],
    applyAutoFixes: () => ({ applied: [], skipped: [] }),
    loadKbDescriptor: () => ({
      id: 'demo', name: 'demo', binding: { kind: 'project', ref: 'demo' }, desc: 'x',
      processes: {
        lint: { builtin: 'forge-brain-lint' },
        ingest: { cmd: 'failing-ingest' },
        consolidate: { builtin: 'brain-fix' },
        usage: { readSurface: 'navigation-index', readers: ['reflector'] },
      },
    }) as never,
    runCmdProcess: () => 7, // non-zero
  };
  const events: EventLogEntry[] = [];
  const result = runPostReflectionKbHealth({
    forgeRoot, cycleId: 'CID', candidateKbIds: ['demo'],
    sinceMs: START, logger: fakeLogger(events), initiativeId: 'INIT', deps,
  });
  assert.equal(result.kbs.find((k) => k.kbId === 'demo')?.ingest, 'failed', 'non-zero cmd exit → failed');
  const ev = events.find((e) => e.message === 'reflect.kb-ingest');
  assert.equal(ev?.event_type, 'error', 'a failed process is emitted at event_type error');
});
