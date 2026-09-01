/**
 * KbBackend CONFORMANCE — the admission gate for any knowledge-base backend.
 *
 * This file replaces the four `assert.ok(Array.isArray(...))` shape checks that
 * lived in `kb-backend.test.ts` (`listPendingGuidance returns an array`, and the
 * three array assertions inside the per-descriptor interface case). Those checks
 * are passed by a backend that returns `[]` for everything — they admit exactly
 * the implementation they exist to reject. Every case below asserts CONTENT
 * against a seeded fixture and names, in its own header, the wrong
 * implementation it kills.
 *
 * Scope (SPEC.md §4 as amended by H8): `KbBackend` is the seam for **per-KB**
 * reads and writes. Cross-brain navigation (`loadBrainIndex`) sits above it and
 * is deliberately not asserted here.
 *
 * The last two sections are the ones that make the seam load-bearing rather
 * than decorative: they inject a STUB backend into `kb-lint-summary.ts` and
 * `kb-health.ts` and prove the result follows the stub. A module that still
 * resolved the brain dir for itself would ignore the stub and fail them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getKbBackend,
  tryGetKbBackend,
  FilesystemKbBackend,
  type KbBackend,
} from '../../kb-backend.ts';
import { computeKbLintChecks, scopeFindingsToKb } from '../../kb-lint-summary.ts';
import { runPostReflectionKbHealth } from '../../kb-health.ts';
import type { Finding } from '../../brain-lint.ts';
import type { EventLogger } from '@forge/kernel';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Fixture — a seeded brain with the shapes the real tree has: a top-level KB,
// its NAME-PREFIX SIBLING (the live cross-KB-write defect this scoping exists
// to prevent), a central per-project brain (ADR 035) and a forge sub-wiki.
// ---------------------------------------------------------------------------

const INDEX_PAGE = 'README.md';
const OLD_MTIME_S = 1_000_000; // ~1970; unambiguously older than any `sinceMs` used below

type Fixture = {
  root: string;
  /** `brain/alpha` — the KB under test. */
  alpha: string;
  /** `brain/alpha-two` — the prefix sibling that must never fold into alpha. */
  sibling: string;
  /** `brain/projects/proj` — a central per-project brain (ADR 035). */
  project: string;
  /** `brain/cycles` — a forge sub-wiki (ADR 018 routing rules apply). */
  forgeWiki: string;
};

function seedKb(root: string, relDir: string, id: string, themes: readonly string[]): string {
  const dir = join(root, relDir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(
    join(dir, 'kb.yaml'),
    `id: ${id}\nname: ${id}\nbinding:\n  kind: unique\ndesc: seeded fixture\nbackend: filesystem\norigin: seed\n`,
  );
  for (const name of themes) {
    writeFileSync(
      join(dir, 'themes', name),
      `---\ntitle: ${name}\ndescription: seeded\ncategory: pattern\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n\nbody\n`,
    );
  }
  return dir;
}

function newFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'forge-kb-conformance-'));
  return {
    root,
    alpha: seedKb(root, join('brain', 'alpha'), 'alpha', ['one.md', 'two.md', 'three.md', INDEX_PAGE]),
    sibling: seedKb(root, join('brain', 'alpha-two'), 'alpha-two', ['sibling.md']),
    project: seedKb(root, join('brain', 'projects', 'proj'), 'proj', ['p.md']),
    forgeWiki: seedKb(root, join('brain', 'cycles'), 'cycles', ['c.md']),
  };
}

function withFixture(fn: (fx: Fixture) => void): void {
  const fx = newFixture();
  try {
    fn(fx);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
}

function finding(file: string, over: Partial<Finding> = {}): Finding {
  return { category: 'flag', file, message: 'seeded finding', ...over };
}

// ---------------------------------------------------------------------------
// §1 contains() — containment, not substring
// ---------------------------------------------------------------------------

test('CONF-1a contains(): a theme of the PREFIX SIBLING is not in this KB — kills the substring implementation (`file.includes(kbId)`), which made consolidating `alpha` write into `alpha-two`', () => {
  withFixture((fx) => {
    const backend = getKbBackend(fx.root, 'alpha');
    assert.equal(backend.contains(join(fx.alpha, 'themes', 'one.md')), true);
    assert.equal(backend.contains(join(fx.sibling, 'themes', 'sibling.md')), false);
  });
});

test('CONF-1b contains(): accepts a forgeRoot-RELATIVE path, which is the shape `Finding.file` actually carries — kills an absolute-only comparison, whose scoping is silently empty for every real finding', () => {
  withFixture((fx) => {
    const backend = getKbBackend(fx.root, 'alpha');
    assert.equal(backend.contains(join('brain', 'alpha', 'themes', 'one.md')), true);
    assert.equal(backend.contains(join('brain', 'alpha-two', 'themes', 'sibling.md')), false);
  });
});

test('CONF-1c contains(): the KB root itself is IN, the brain root and the forge root are OUT — kills a strict-descendant-only rule (drops the "at" case) and a return-true-for-everything stub', () => {
  withFixture((fx) => {
    const backend = getKbBackend(fx.root, 'alpha');
    assert.equal(backend.contains(fx.alpha), true);
    assert.equal(backend.contains(join(fx.root, 'brain')), false);
    assert.equal(backend.contains(fx.root), false);
  });
});

// ---------------------------------------------------------------------------
// §2 ownsTheme() — the KB's own themes dir, not anything under the KB
// ---------------------------------------------------------------------------

test('CONF-2a ownsTheme(): true for a file in this KB\'s OWN themes dir, false for a nested path and for kb.yaml — kills an implementation that delegates to contains(), which would report a check as "scanned this KB" on the strength of a file the scan never opened', () => {
  withFixture((fx) => {
    const backend = getKbBackend(fx.root, 'alpha');
    assert.equal(backend.ownsTheme(join(fx.alpha, 'themes', 'one.md')), true);
    assert.equal(backend.ownsTheme(join(fx.alpha, 'themes', 'nested', 'deep.md')), false);
    assert.equal(backend.ownsTheme(join(fx.alpha, 'kb.yaml')), false);
    assert.equal(backend.ownsTheme(join(fx.sibling, 'themes', 'sibling.md')), false);
  });
});

// ---------------------------------------------------------------------------
// §3 placement() — the KB's place in the brain layout (ADR 018 / ADR 035)
// ---------------------------------------------------------------------------

test('CONF-3a placement(): forge sub-wiki vs central project brain vs neither — kills a constant-returning implementation, and one that calls every top-level KB a forge sub-wiki (the ADR 018 category routing rules would then be enforced against a KB they do not govern)', () => {
  withFixture((fx) => {
    assert.equal(getKbBackend(fx.root, 'cycles').placement(), 'forge');
    assert.equal(getKbBackend(fx.root, 'proj').placement(), 'project');
    assert.equal(getKbBackend(fx.root, 'alpha').placement(), 'other');
  });
});

// ---------------------------------------------------------------------------
// §4 descriptorPath() — resolved per call, never cached at construction
// ---------------------------------------------------------------------------

test('CONF-4a descriptorPath(): points at this KB\'s real kb.yaml and reads back as this KB\'s descriptor', () => {
  withFixture((fx) => {
    const p = getKbBackend(fx.root, 'alpha').descriptorPath();
    assert.ok(p, 'a seeded KB has a descriptor');
    assert.equal(dirname(p), fx.alpha);
    assert.match(readFileSync(p, 'utf8'), /^id: alpha$/m);
  });
});

test('CONF-4b descriptorPath(): goes null once the descriptor is removed from a LIVE backend — kills an implementation that caches the path at construction, which would hand the health dispatcher a kb.yaml that no longer exists', () => {
  withFixture((fx) => {
    const backend = getKbBackend(fx.root, 'alpha');
    assert.ok(backend.descriptorPath());
    rmSync(join(fx.alpha, 'kb.yaml'));
    assert.equal(backend.descriptorPath(), null);
  });
});

// ---------------------------------------------------------------------------
// §5 freshThemeFiles() — content, not an array
// ---------------------------------------------------------------------------

test('CONF-5a freshThemeFiles(): returns exactly the themes newer than `sinceMs`, by name — kills the always-empty backend (which passed every shape check it replaces) and one that ignores `sinceMs`', () => {
  withFixture((fx) => {
    const backend = getKbBackend(fx.root, 'alpha');
    utimesSync(join(fx.alpha, 'themes', 'three.md'), OLD_MTIME_S, OLD_MTIME_S);
    const since = Date.now() - 60_000;

    const fresh = backend.freshThemeFiles(since).map((p) => basename(p)).sort();
    assert.deepEqual(fresh, ['one.md', 'two.md']);

    const all = backend.freshThemeFiles(0).map((p) => basename(p)).sort();
    assert.deepEqual(all, ['one.md', 'three.md', 'two.md']);
  });
});

test('CONF-5b freshThemeFiles(): index pages and non-markdown are excluded even when fresh — kills an implementation that reports a fresh-theme count including pages the reflector never wrote', () => {
  withFixture((fx) => {
    const backend = getKbBackend(fx.root, 'alpha');
    writeFileSync(join(fx.alpha, 'themes', 'notes.txt'), 'not markdown');
    const fresh = backend.freshThemeFiles(0).map((p) => basename(p));
    assert.ok(!fresh.includes(INDEX_PAGE), `${INDEX_PAGE} is an index page, not a theme`);
    assert.ok(!fresh.includes('notes.txt'), 'non-markdown is not a theme');
    assert.equal(fresh.length, 3);
  });
});

// ---------------------------------------------------------------------------
// §6 tryGetKbBackend — the non-throwing resolver the lint/health sites need
// ---------------------------------------------------------------------------

test('CONF-6a tryGetKbBackend(): a backend for a real KB, null for an unknown one — while getKbBackend still throws, so neither caller\'s contract silently changed', () => {
  withFixture((fx) => {
    assert.ok(tryGetKbBackend(fx.root, 'alpha') instanceof FilesystemKbBackend);
    assert.equal(tryGetKbBackend(fx.root, 'no-such-kb'), null);
    assert.throws(() => getKbBackend(fx.root, 'no-such-kb'), /Unknown kbId/);
  });
});

// ---------------------------------------------------------------------------
// §7 THE SEAM IS LOAD-BEARING — inject a stub and prove the answer follows it.
// A module that still resolved the brain dir for itself passes every case
// above and fails every case below. This is what SPEC.md §4's "a per-KB read
// path that bypasses it is a defect" is worth as an assertion.
// ---------------------------------------------------------------------------

function stubBackend(over: Partial<KbBackend>): KbBackend {
  const base: KbBackend = {
    kbId: 'stub',
    buildGraph: () => ({ nodes: [], edges: [], externalEdges: [] }) as unknown as ReturnType<KbBackend['buildGraph']>,
    getNodeArticle: () => null,
    listPendingGuidance: () => [],
    deleteGuidanceFile: () => false,
    search: () => [],
    contains: () => false,
    ownsTheme: () => false,
    placement: () => 'other',
    descriptorPath: () => null,
    freshThemeFiles: () => [],
  };
  return { ...base, ...over };
}

test('CONF-7a scopeFindingsToKb() scopes through the INJECTED backend\'s contains(), not through its own directory resolution', () => {
  withFixture((fx) => {
    const mine = join(fx.alpha, 'themes', 'one.md');
    const theirs = join(fx.sibling, 'themes', 'sibling.md');
    const findings = [finding(mine), finding(theirs)];

    // The stub claims the SIBLING's file and disowns alpha's. A module that
    // resolved `brain/alpha` for itself would return the opposite.
    const scoped = scopeFindingsToKb(
      fx.root,
      'alpha',
      findings,
      stubBackend({ contains: (f) => resolve(fx.root, f) === theirs }),
    );
    assert.deepEqual(scoped.map((f) => f.file), [theirs]);
  });
});

test('CONF-7b computeKbLintChecks() takes its CHECK_SCOPE domain from the INJECTED backend\'s placement(), not from isForgeBrainDir on a self-resolved path', () => {
  withFixture((fx) => {
    const findings: Finding[] = [];
    const statusOf = (r: ReturnType<typeof computeKbLintChecks>, check: string): string =>
      r.checks.find((c) => c.check === check)?.status ?? 'MISSING';

    // `checkIndexSync` is CHECK_SCOPE 'forge-themes'. alpha is NOT a forge
    // sub-wiki on disk; the stub says it is, so the check must be applicable.
    const asForge = computeKbLintChecks(fx.root, 'alpha', findings, stubBackend({ placement: () => 'forge' }));
    assert.notEqual(statusOf(asForge, 'checkIndexSync'), 'n/a');

    // `checkProjectBrainIndexes` is 'project-indexes'. Same KB, stub says
    // 'other' → both domain-scoped checks report the honest 'n/a'.
    const asOther = computeKbLintChecks(fx.root, 'alpha', findings, stubBackend({ placement: () => 'other' }));
    assert.equal(statusOf(asOther, 'checkIndexSync'), 'n/a');
    assert.equal(statusOf(asOther, 'checkProjectBrainIndexes'), 'n/a');

    const asProject = computeKbLintChecks(fx.root, 'alpha', findings, stubBackend({ placement: () => 'project' }));
    assert.notEqual(statusOf(asProject, 'checkProjectBrainIndexes'), 'n/a');
  });
});

test('CONF-7c computeKbLintChecks() rolls its findings up through the INJECTED backend\'s contains()', () => {
  withFixture((fx) => {
    const mine = join(fx.alpha, 'themes', 'one.md');
    const findings = [
      finding(mine, { category: 'error', check: 'checkFrontmatter' }),
      finding(join(fx.sibling, 'themes', 'sibling.md'), { category: 'error', check: 'checkFrontmatter' }),
    ];
    const r = computeKbLintChecks(fx.root, 'alpha', findings, stubBackend({ contains: (f) => resolve(fx.root, f) === mine }));
    assert.equal(r.lintErrors, 1, 'exactly the one finding the backend claims');
    assert.equal(r.lintFlags, 0);
  });
});

test('CONF-7d runPostReflectionKbHealth() takes its fresh-theme set and its descriptor from the INJECTED backend', () => {
  withFixture((fx) => {
    const emitted: Array<Record<string, unknown>> = [];
    const logger = { emit: (e: Record<string, unknown>) => { emitted.push(e); } } as unknown as EventLogger;

    // The stub reports two fresh themes for a KB whose real themes dir the
    // fixture never touched, and no descriptor (so no `cmd` process path).
    const result = runPostReflectionKbHealth({
      forgeRoot: fx.root,
      cycleId: 'cyc-1',
      candidateKbIds: ['alpha'],
      sinceMs: Date.now(),
      logger,
      initiativeId: 'INIT-1',
      deps: {
        resolveBackend: () => stubBackend({ freshThemeFiles: () => ['/seeded/a.md', '/seeded/b.md'] }),
        lintThemeFiles: () => [],
        applyAutoFixes: () => ({ applied: [], skipped: [] }) as ReturnType<NonNullable<Parameters<typeof runPostReflectionKbHealth>[0]['deps']>['applyAutoFixes'] & object>,
        regenerateBrainIndex: () => {},
      },
    });

    assert.deepEqual(result.kbs.map((k) => k.kbId), ['alpha']);
    assert.equal(result.kbs[0].freshThemes, 2, 'the count is the injected backend\'s, not a filesystem read');
  });
});

test('CONF-7e runPostReflectionKbHealth() skips a KB the injected resolver does not know — the same answer the direct resolution gave, now through the seam', () => {
  withFixture((fx) => {
    const logger = { emit: () => {} } as unknown as EventLogger;
    const result = runPostReflectionKbHealth({
      forgeRoot: fx.root,
      cycleId: 'cyc-1',
      candidateKbIds: ['alpha'],
      sinceMs: Date.now(),
      logger,
      initiativeId: 'INIT-1',
      deps: { resolveBackend: () => null },
    });
    assert.deepEqual(result.kbs, []);
  });
});

// ---------------------------------------------------------------------------
// §8 The bypass ratchet. SPEC.md §4: "a per-KB read path that bypasses it is a
// defect, not an optimisation." These two modules were the four measured
// bypasses; this pins that they stay closed.
// ---------------------------------------------------------------------------

test('CONF-8a kb-lint-summary.ts and kb-health.ts resolve no KB brain directory of their own', () => {
  for (const rel of ['kb-lint-summary.ts', 'kb-health.ts']) {
    const src = readFileSync(join(PKG_DIR, rel), 'utf8');
    const hits = src.split('\n').filter((l) => l.includes('resolveKbBrainDir') && !l.trimStart().startsWith('*'));
    assert.deepEqual(hits, [], `${rel} must reach a KB's store through KbBackend, not resolveKbBrainDir`);
  }
});
