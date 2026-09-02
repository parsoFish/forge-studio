/**
 * Unit tests for `brain-lint.ts` itself — the check registry and the runners over it.
 *
 * classifyFinding · resolutionCounts · runBrainLint · lintThemeFiles · CHECK_NAMES · CHECK_SCOPE · LINT_THEME_FILE_CHECKS · the severity lock. Eight of these cases name a single check in their body but assert through a runner that iterates the WHOLE registry, so they cannot be filed under any one check module.
 *
 * Split out of `brain-lint.test.ts` (1,463 lines) in M4: 17 of its 65 cases,
 * filed by the module that owns each case's SUBJECT. Shared fixtures live in
 * `./test-fixtures/brain-lint.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runBrainLint,
  classifyFinding,
  resolutionCounts,
  lintThemeFiles,
  CHECK_NAMES,
  CHECK_SCOPE,
  LINT_THEME_FILE_CHECKS,
} from '../../brain-lint.ts';

import { buildBrainFixture, cleanup, cf, writeProjectTheme } from './test-fixtures/brain-lint.ts';

test('classifyFinding: AUTO tier — deterministic fixes', () => {
  assert.equal(classifyFinding(cf('checkIndexSync', 'not listed in category index: brain/cycles/patterns.md')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkIndexSync', 'listed 2 times in category index: x')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkOrphans', 'orphan: not linked from INDEX.md')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkCategoryScope', 'category "pattern" belongs in brain/cycles/themes/')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkFrontmatter', 'created_at > updated_at')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkFrontmatter', 'missing required frontmatter field: updated_at')).resolution, 'auto');
});

test('classifyFinding: AGENT tier — LLM-resolvable, carries a fixHint', () => {
  for (const m of [
    ['checkFrontmatter', 'missing required frontmatter field: description'],
    ['checkFrontmatter', 'unparseable frontmatter (gray-matter failed)'],
    ['checkSourceLinks', 'broken wikilink: [[foo-bar]]'],
    ['checkSourceLinks', 'broken link: ../x.md'],
    ['checkStaleness', 'stale citation (missing): orchestrator/gone.ts'],
    ['checkLengthSoftCap', 'theme too long: 142 body lines (hard cap 100)'],
    ['checkIndexSync', 'category index missing: brain/cycles/patterns.md'],
  ] as const) {
    const r = classifyFinding(cf(m[0], m[1]));
    assert.equal(r.resolution, 'agent', `${m[1]} → agent`);
    assert.ok(r.fixHint && r.fixHint.length > 0, `${m[1]} should carry a fixHint`);
  }
});

test('classifyFinding: USER tier — needs a human decision', () => {
  assert.equal(classifyFinding(cf('checkFrontmatter', 'category "bug" not in whitelist {pattern|...}')).resolution, 'user');
  assert.equal(classifyFinding(cf('checkCleanupCandidates', 'cleanup: tier-C (load-bearing — never auto)')).resolution, 'user');
  assert.equal(classifyFinding(cf('checkCleanupCandidates', 'cleanup: tier-B (routine, > 30 days old)')).resolution, 'user');
});

test('classifyFinding: unknown check → user (fail-safe, never silent auto-edit)', () => {
  assert.equal(classifyFinding(cf('checkNewThing', 'whatever')).resolution, 'user');
  assert.equal(classifyFinding(cf('checkNewThing', 'whatever')).kind, 'unknown');
});

test('resolutionCounts: tallies by tier (classifies unstamped findings)', () => {
  const counts = resolutionCounts([
    cf('checkOrphans', 'orphan: x'),
    cf('checkSourceLinks', 'broken wikilink: [[y]]'),
    cf('checkFrontmatter', 'category "bug" not in whitelist {pattern|...}'),
  ]);
  assert.deepEqual(counts, { auto: 1, agent: 1, user: 1 });
});

test('runBrainLint stamps every finding with kind + resolution', () => {
  // Reuse a fixture that produces findings: a theme missing from its index.
  const r = runBrainLint({ cwd: process.cwd(), scope: 'full' });
  for (const f of r.findings) {
    assert.ok(f.kind, `finding has a kind: ${f.message}`);
    assert.ok(f.resolution, `finding has a resolution: ${f.message}`);
  }
});

test('classifyFinding: checkProjectBrainIndexes → agent tier with fixHint', () => {
  const f = classifyFinding(cf('checkProjectBrainIndexes', 'not listed in project category index: x'));
  assert.equal(f.resolution, 'agent');
  assert.equal(f.kind, 'index.project');
  assert.ok(f.fixHint && f.fixHint.length > 0);
});

/**
 * F3 hardening: `runBrainLint` now iterates a single `FULL_SCOPE_CHECKS`
 * registry that `CHECK_NAMES` is ALSO derived from (kept private/unexported —
 * `CHECK_NAMES` and `CHECK_SCOPE` are the intended public surface), so the two
 * can no longer drift apart BY CONSTRUCTION. This test is the independent,
 * fixture-based verification the WI calls for: a maximal fixture engineered
 * to trip every one of the 10 full-scope checks simultaneously, asserting the
 * set of `check` names `runBrainLint(scope:'full')` actually EMITS findings
 * under is EXACTLY `CHECK_NAMES` — no more, no fewer. A future edit that
 * re-introduces two separate hand-typed lists (the exact shape that caused
 * the original MAJOR — `CHECK_NAMES` hand-duplicated in
 * cli/bridge-studio-kbs.test.ts instead of imported) and lets them drift
 * would fail this test, because it exercises REAL runtime behavior, not the
 * internal wiring.
 */
test('CHECK_NAMES drift guard: a maximal fixture tripping every check emits findings under EXACTLY the CHECK_NAMES set', () => {
  const root = buildBrainFixture({
    themes: [
      // checkFrontmatter (missing description) + checkIndexSync + checkOrphans
      // (never linked from any category index / INDEX.md — the default stub
      // indexes carry no entries).
      { path: 'cycles/themes/max-a.md', fm: { category: 'pattern', description: '' }, body: '# Max A\n\nFixture body.\n' },

      // checkSourceLinks (broken relative link + broken wikilink) + checkStaleness
      // (a cited forge-internal path that does not exist).
      {
        path: 'cycles/themes/max-b.md',
        fm: { category: 'pattern' },
        body:
          '# Max B\n\nBroken link: [bad](./does-not-exist.md)\n\nBroken wikilink: [[no-such-theme-xyz]]\n\n' +
          'Stale citation: `orchestrator/does-not-exist-xyz.ts`\n',
      },

      // checkLengthSoftCap (hard cap, > 100 body lines).
      {
        path: 'cycles/themes/max-c.md',
        fm: { category: 'pattern' },
        body: '# Max C\n\n' + Array.from({ length: 110 }, (_, i) => `line ${i}`).join('\n') + '\n',
      },

      // checkCategoryScope — a `decision` theme mis-routed into cycles/themes/
      // (decisions belong in forge-dev/themes/).
      { path: 'cycles/themes/max-f.md', fm: { category: 'decision' }, body: '# Max F\n' },

      // checkDanglingEdges — a related_themes slug that resolves nowhere
      // under brain/**/themes/.
      { path: 'cycles/themes/max-g.md', fm: { category: 'pattern', related_themes: ['max-slug-does-not-exist-xyz'] }, body: '# Max G\n' },

      // checkDuplicateThemes — a title-normalization collision pair.
      { path: 'cycles/themes/max-h-dup1.md', fm: { category: 'pattern', title: 'Max Duplicate Pair' }, body: '# Max H\n' },
      { path: 'cycles/themes/max-i-dup2.md', fm: { category: 'pattern', title: 'max duplicate pair!' }, body: '# Max I\n' },
    ],
  });
  try {
    // checkProjectBrainIndexes — a project theme with no category index files.
    writeProjectTheme(root, 'max-project', 'max-proj-theme', 'pattern');

    // checkReflectorLoss — a `_queue/done/` manifest with no matching archive
    // (brain/cycles/_raw/ is never created by buildBrainFixture, so ANY
    // manifest here is automatically unmatched).
    const doneDir = join(root, '_queue', 'done');
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(join(doneDir, 'MAX-LOST-INIT.md'), '---\ninitiative_id: MAX-LOST-INIT\n---\n\nbody\n');

    const { findings } = runBrainLint({ cwd: root, scope: 'full' });
    const tripped = new Set(findings.map((f) => f.check).filter((c): c is string => Boolean(c)));

    const expected = [...CHECK_NAMES].sort();
    const actual = [...tripped].sort();
    assert.deepEqual(
      actual,
      expected,
      `maximal fixture must trip findings under EXACTLY the CHECK_NAMES set. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (missing: ${JSON.stringify(expected.filter((n) => !actual.includes(n)))}, extra: ${JSON.stringify(actual.filter((n) => !expected.includes(n)))})`,
    );
  } finally {
    cleanup(root);
  }
});

test('SEVERITY LOCK: a fixture whose ONLY problems are one dangling edge and one duplicate pair keeps runBrainLint exitCode 0, with every finding from the two new checks category:"flag" (kills an implementation that raises them as errors and silently breaks the `forge brain lint` gate)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/lone.md', fm: { title: 'Lone Theme', related_themes: ['missing-slug'] } },
      { path: 'cycles/themes/dup-x.md', fm: { title: 'Duplicate Title' } },
      { path: 'cycles/themes/dup-y.md', fm: { title: 'duplicate title!' } },
    ],
    extra: [
      {
        path: 'cycles/patterns.md',
        content:
          '# patterns\n\n' +
          '- [Lone Theme](./themes/lone.md)\n' +
          '- [Duplicate Title](./themes/dup-x.md)\n' +
          '- [Duplicate Title Two](./themes/dup-y.md)\n',
      },
    ],
  });
  try {
    const { findings, exitCode } = runBrainLint({ cwd: root, scope: 'full' });
    assert.equal(exitCode, 0, `exitCode must be 0 (flag-only fixture), got ${exitCode}. Findings: ${JSON.stringify(findings)}`);

    const relevant = findings.filter(
      (f) => f.check === 'checkDanglingEdges' || f.check === 'checkDuplicateThemes',
    );
    assert.equal(
      relevant.length,
      2,
      `expected exactly 2 findings total (1 dangling + 1 duplicate pair), got ${JSON.stringify(findings)}`,
    );
    for (const f of relevant) {
      assert.equal(f.category, 'flag', `${f.check} finding must be category:'flag', never 'error', got ${JSON.stringify(f)}`);
    }
    // This fixture is otherwise squeaky-clean (linked, no broken links, no
    // mis-routing, no length/contradiction/project/reflector issues) — so the
    // two new-check findings really are the ONLY problems, not merely a
    // filtered subset of a noisier fixture.
    assert.equal(
      findings.length,
      2,
      `fixture must be otherwise clean — any other finding means the fixture isn't isolating the two new checks. Got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('CHECK_NAMES: exactly the 11 expected full-scope check names (kills a registration that adds the check function but forgets to append it to FULL_SCOPE_CHECKS)', () => {
  const expected = [
    'checkFrontmatter',
    'checkIndexSync',
    'checkSourceLinks',
    'checkStaleness',
    'checkOrphans',
    'checkProjectBrainIndexes',
    'checkLengthSoftCap',
    'checkCategoryScope',
    'checkReflectorLoss',
    'checkDanglingEdges',
    'checkDuplicateThemes',
  ];
  assert.equal(CHECK_NAMES.length, 11, `expected 11 full-scope checks, got ${CHECK_NAMES.length}: ${JSON.stringify(CHECK_NAMES)}`);
  assert.deepEqual(
    [...CHECK_NAMES].sort(),
    [...expected].sort(),
    `CHECK_NAMES must be exactly the expected 11-name set, got ${JSON.stringify(CHECK_NAMES)}`,
  );
});

test('CHECK_SCOPE: every CHECK_NAMES entry has a CHECK_SCOPE mapping, and every mapping is a known scope (kills a registration that updates CHECK_NAMES but forgets CHECK_SCOPE, silently defaulting per-KB health to a false verdict)', () => {
  // `themes` = the readThemeFiles domain, which since ADR 035 includes
  // brain/projects/<name>/themes. `forge-themes` is narrower and means the
  // RULE — the ADR 018 category→sub-wiki routing — governs the two forge
  // sub-wikis only. The split is what lets a per-KB consumer tell "scanned and
  // clean" from "does not apply here"; before it, all ten theme checks claimed
  // the forge-only domain and a project brain could only be reported n/a.
  assert.equal(CHECK_SCOPE['checkDanglingEdges'], 'themes');
  assert.equal(CHECK_SCOPE['checkDuplicateThemes'], 'themes');
  assert.equal(CHECK_SCOPE['checkCategoryScope'], 'forge-themes');
  assert.equal(CHECK_SCOPE['checkIndexSync'], 'forge-themes');
  const KNOWN = new Set(['themes', 'forge-themes', 'project-indexes', 'global']);
  for (const name of CHECK_NAMES) {
    assert.ok(name in CHECK_SCOPE, `CHECK_SCOPE is missing an entry for "${name}" (CHECK_NAMES/CHECK_SCOPE drift)`);
    assert.ok(KNOWN.has(CHECK_SCOPE[name]), `CHECK_SCOPE["${name}"] is "${CHECK_SCOPE[name]}", not one of ${[...KNOWN].join('|')}`);
  }
});

test('LINT_THEME_FILE_CHECKS: declares both new checks AND lintThemeFiles(forgeRoot, files) actually emits findings under both check names (kills declaring membership without implementing it — the declared-data-fails-open shape)', () => {
  assert.ok(LINT_THEME_FILE_CHECKS.has('checkDanglingEdges'), 'LINT_THEME_FILE_CHECKS must include checkDanglingEdges');
  assert.ok(LINT_THEME_FILE_CHECKS.has('checkDuplicateThemes'), 'LINT_THEME_FILE_CHECKS must include checkDuplicateThemes');

  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/lf-dangler.md', fm: { related_themes: ['lf-nowhere-slug'] } },
      { path: 'cycles/themes/lf-dup-a.md', fm: { title: 'Lint File Dup' } },
      { path: 'cycles/themes/lf-dup-b.md', fm: { title: 'lint file dup' } },
    ],
  });
  try {
    const files = [
      join(root, 'brain', 'cycles', 'themes', 'lf-dangler.md'),
      join(root, 'brain', 'cycles', 'themes', 'lf-dup-a.md'),
      join(root, 'brain', 'cycles', 'themes', 'lf-dup-b.md'),
    ];
    const findings = lintThemeFiles(root, files);
    assert.ok(
      findings.some((f) => f.check === 'checkDanglingEdges'),
      `lintThemeFiles must emit a checkDanglingEdges finding for the seeded dangling edge, got ${JSON.stringify(findings)}`,
    );
    assert.ok(
      findings.some((f) => f.check === 'checkDuplicateThemes'),
      `lintThemeFiles must emit a checkDuplicateThemes finding for the seeded duplicate pair, got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('lintThemeFiles: frontmatter parsing is order-independent — a prior parse of the same invalid-YAML content must not poison a later read into phantom missing-field findings (W7 FIX-B-KB, kb-maintain consolidate regression)', () => {
  // gray-matter throws on this description's unquoted `: ` — parseTheme's
  // lenient fallback recovers the fields. But gray-matter populates its
  // module-level cache BEFORE the parse throws, so a SECOND parse of the
  // byte-identical content silently returned `data: {}` from the poisoned
  // cache and the fallback never ran. Journey sequence that hit this:
  // checkProjectBrainIndexes parsed the theme first (fallback fine), then
  // collectKbFindings' own-theme lens re-parsed it and invented five
  // "missing required frontmatter field" findings for fields plainly
  // present — three of them agent-tier, so consolidate could never reach
  // cleared under no-spawn (the kb-maintain "not-cleared" gate failure).
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-cache-'));
  try {
    const themesDir = join(root, 'brain', 'projects', 'poison-kb', 'themes');
    mkdirSync(themesDir, { recursive: true });
    const file = join(themesDir, 'colon-desc.md');
    writeFileSync(file, [
      '---',
      'title: Colon description fixture',
      // Unique per run so a previous process/test never pre-poisons it; the
      // two reads under test share the SAME content within this test.
      `description: A scratch lint fixture: unquoted colon makes gray-matter throw (poison-${Date.now()})`,
      'category: pattern',
      'created_at: 2026-01-01T00:00:00Z',
      'updated_at: 2026-01-01T00:00:00Z',
      '---',
      '',
      '# body',
      '',
    ].join('\n'));
    const first = lintThemeFiles(root, [file]).filter((f) => f.check === 'checkFrontmatter');
    const second = lintThemeFiles(root, [file]).filter((f) => f.check === 'checkFrontmatter');
    assert.deepEqual(first, [], `first pass must recover every field via the lenient fallback, got ${JSON.stringify(first)}`);
    assert.deepEqual(second, [], `second pass of the SAME content must match the first — phantom findings here mean a poisoned parse cache, got ${JSON.stringify(second)}`);
  } finally {
    cleanup(root);
  }
});

test('lintThemeFiles: a dangling related_themes edge is still flagged when the frontmatter needs the lenient fallback (W7 FIX-B-KB: the fallback stored the list as a raw string, danglingEdgeFindings skipped non-arrays — the kb-drain beat saw a false instant green)', () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-fbdangle-'));
  try {
    const themesDir = join(root, 'brain', 'projects', 'fallback-dangle-kb', 'themes');
    mkdirSync(themesDir, { recursive: true });
    const file = join(themesDir, 'dangler.md');
    writeFileSync(file, [
      '---',
      'title: Fallback dangler fixture',
      // Unquoted `: ` -> gray-matter throws -> regex fallback parses the fields.
      `description: A scratch fixture: unquoted colon forces the fallback (fbdangle-${Date.now()})`,
      'category: pattern',
      'related_themes: [this-slug-exists-nowhere-under-brain]',
      'created_at: 2026-01-01T00:00:00Z',
      'updated_at: 2026-01-01T00:00:00Z',
      '---',
      '',
      '# body',
      '',
    ].join('\n'));
    const findings = lintThemeFiles(root, [file]);
    const dangling = findings.filter((f) => f.check === 'checkDanglingEdges');
    assert.equal(
      dangling.length,
      1,
      `the seeded dangling edge must be flagged even through the fallback parse — a raw-string related_themes silently skipping the check is the false-green drain defect, got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('lintThemeFiles: checkCategoryScope governs ONLY the forge sub-wikis — a scratch/band KB\'s own themes are never flagged mis-routed (W7 FIX-B-KB: the auto-tier mover that would drag scratch themes into brain/cycles|forge-dev)', () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-catscope-'));
  try {
    // A category-bearing theme in a top-level NON-forge KB dir (the shape
    // every flow/band/scratch KB has): the category→sub-wiki routing rule is
    // a three-brain (ADR 018) convention for the forge brains only, so no
    // mis-routed finding may fire here — classify() maps it to the AUTO tier
    // whose fixer git-mv's the file into brain/<sub>/themes/.
    const scratchThemes = join(root, 'brain', 'scratch-kb', 'themes');
    mkdirSync(scratchThemes, { recursive: true });
    const scratchTheme = join(scratchThemes, 'a-pattern.md');
    writeFileSync(scratchTheme, [
      '---', 'title: Scratch pattern', 'description: scratch KB theme.', 'category: pattern',
      'created_at: 2026-01-01T00:00:00Z', 'updated_at: 2026-01-01T00:00:00Z', '---', '', '# body', '',
    ].join('\n'));
    const scratchFindings = lintThemeFiles(root, [scratchTheme]);
    assert.ok(
      !scratchFindings.some((f) => f.check === 'checkCategoryScope'),
      `a non-forge KB's own theme must never trip checkCategoryScope, got ${JSON.stringify(scratchFindings)}`,
    );

    // …while a genuinely mis-routed FORGE theme (a decision sitting in
    // brain/cycles) still gets flagged — the check stays real in its domain.
    const cyclesThemes = join(root, 'brain', 'cycles', 'themes');
    mkdirSync(cyclesThemes, { recursive: true });
    const misrouted = join(cyclesThemes, 'a-decision.md');
    writeFileSync(misrouted, [
      '---', 'title: Misrouted decision', 'description: belongs in forge-dev.', 'category: decision',
      'created_at: 2026-01-01T00:00:00Z', 'updated_at: 2026-01-01T00:00:00Z', '---', '', '# body', '',
    ].join('\n'));
    const forgeFindings = lintThemeFiles(root, [misrouted]);
    assert.ok(
      forgeFindings.some((f) => f.check === 'checkCategoryScope'),
      `a mis-categorized forge sub-wiki theme must still trip checkCategoryScope, got ${JSON.stringify(forgeFindings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('classifyFinding: checkDanglingEdges/checkDuplicateThemes classify as agent-tier with a non-empty fixHint, and resolutionCounts tallies them under "agent" (kills a classifyFinding that leaves the new checks unhandled, silently falling through to the "user" default)', () => {
  const dangling = classifyFinding(cf('checkDanglingEdges', 'dangling related_themes slug: missing-slug'));
  assert.equal(dangling.kind, 'edge.dangling');
  assert.equal(dangling.resolution, 'agent');
  assert.ok(dangling.fixHint && dangling.fixHint.length > 0, 'checkDanglingEdges must carry a non-empty fixHint');

  const duplicate = classifyFinding(cf('checkDuplicateThemes', 'possible duplicate of cycles/themes/other.md'));
  assert.equal(duplicate.kind, 'theme.duplicate');
  assert.equal(duplicate.resolution, 'agent');
  assert.ok(duplicate.fixHint && duplicate.fixHint.length > 0, 'checkDuplicateThemes must carry a non-empty fixHint');

  const counts = resolutionCounts([
    cf('checkDanglingEdges', 'dangling related_themes slug: x'),
    cf('checkDuplicateThemes', 'possible duplicate of y'),
  ]);
  assert.deepEqual(counts, { auto: 0, agent: 2, user: 0 });
});

test('runBrainLint(full): a broken source link in a project brain (Brain 3) is REPORTED — ADR 035', () => {
  const root = buildBrainFixture({
    themes: [
      {
        path: 'projects/demo/themes/2026-01-01-cites-a-missing-file.md',
        fm: { category: 'antipattern' },
        body: '# t\n\n- [`gone.md`](../../../../docs/gone.md) — cycle archive that is not there.\n',
      },
    ],
    extra: [
      { path: 'projects/demo/antipatterns.md', content: '# demo — Antipatterns\n\n- [`2026-01-01-cites-a-missing-file`](./themes/2026-01-01-cites-a-missing-file.md) — d\n' },
    ],
  });
  try {
    const { findings } = runBrainLint({ cwd: root, scope: 'full' });
    const broken = findings.filter(
      (f) => f.check === 'checkSourceLinks' && f.file.includes('projects/demo/themes/'),
    );
    assert.equal(broken.length, 1, `expected the project theme's dead link to be reported, got ${JSON.stringify(findings, null, 2)}`);
    assert.equal(broken[0].category, 'error');
    assert.match(broken[0].message, /broken link: \.\.\/\.\.\/\.\.\/\.\.\/docs\/gone\.md/);
  } finally {
    cleanup(root);
  }
});
