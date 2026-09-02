/**
 * Unit tests for `brain-lint-checks-graph.ts` — do themes relate to each other honestly?
 *
 * checkDanglingEdges · checkDuplicateThemes.
 *
 * Split out of `brain-lint.test.ts` (1,463 lines) in M4: 17 of its 65 cases,
 * filed by the module that owns each case's SUBJECT. Shared fixtures live in
 * `./test-fixtures/brain-lint.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkDanglingEdges,
  checkDuplicateThemes,
} from '../../brain-lint.ts';

import { buildBrainFixture, cleanup } from './test-fixtures/brain-lint.ts';

test('checkDanglingEdges: a related_themes slug with no matching theme file anywhere produces exactly one finding naming the file and the slug (kills a no-op / unimplemented check)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/has-dangler.md', fm: { related_themes: ['does-not-exist'] } },
    ],
  });
  try {
    const findings = checkDanglingEdges(root);
    const hits = findings.filter((f) => f.file.endsWith('has-dangler.md'));
    assert.equal(hits.length, 1, `expected exactly one finding, got ${JSON.stringify(findings)}`);
    assert.equal(hits[0].check, 'checkDanglingEdges');
    assert.match(hits[0].message, /does-not-exist/);
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: a related_themes slug resolving in a DIFFERENT forge sub-wiki (cycles -> forge-dev) is NOT dangling (kills a naive same-directory-only / same-sub-wiki-only slug resolution)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/a.md', fm: { related_themes: ['b'] } },
      { path: 'forge-dev/themes/b.md', fm: {} },
    ],
  });
  try {
    const findings = checkDanglingEdges(root);
    assert.equal(
      findings.filter((f) => f.file.endsWith('a.md')).length,
      0,
      `slug "b" resolves in brain/forge-dev/themes/ — must not be reported dangling, got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: two bad slugs in one theme yields two findings (kills an implementation that dedupes per-file rather than per-slug)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/multi.md', fm: { related_themes: ['missing-one', 'missing-two'] } },
    ],
  });
  try {
    const findings = checkDanglingEdges(root).filter((f) => f.file.endsWith('multi.md'));
    assert.equal(findings.length, 2, `expected two findings (one per bad slug), got ${JSON.stringify(findings)}`);
    assert.ok(findings.some((f) => /missing-one/.test(f.message)));
    assert.ok(findings.some((f) => /missing-two/.test(f.message)));
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: a theme with no related_themes key at all produces zero findings and does not crash (kills an implementation that assumes the field always exists / throws on undefined)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    // Planted directly on disk WITHOUT the related_themes key — buildBrainFixture's
    // ThemeSpec always writes `related_themes: []`, which is a different (and
    // easier) shape than "key absent entirely". Many real themes predate the
    // field, so the check must tolerate `data.related_themes === undefined`.
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'nokey.md'),
      '---\ntitle: No Key\ndescription: none.\ncategory: pattern\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n---\n\n# No Key\n',
    );
    const findings = checkDanglingEdges(root);
    assert.equal(findings.length, 0, `expected no findings/crash, got ${JSON.stringify(findings)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: related_themes entries with a trailing ".md" suffix, surrounding whitespace, or both, normalize and resolve when the target theme exists — zero findings (kills replacing the trim()/".md"-strip normalization with a bare String(rawEntry))', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/norm-target.md', fm: {} },
      { path: 'cycles/themes/norm-suffix.md', fm: { related_themes: ['norm-target.md'] } },
      { path: 'cycles/themes/norm-whitespace.md', fm: { related_themes: ['  norm-target  '] } },
      { path: 'cycles/themes/norm-both.md', fm: { related_themes: ['  norm-target.md  '] } },
    ],
  });
  try {
    const findings = checkDanglingEdges(root);
    const hits = findings.filter(
      (f) =>
        f.file.endsWith('norm-suffix.md') ||
        f.file.endsWith('norm-whitespace.md') ||
        f.file.endsWith('norm-both.md'),
    );
    assert.equal(
      hits.length,
      0,
      `".md"-suffixed / whitespace-padded related_themes entries must normalize and resolve against the existing target, got ${JSON.stringify(hits)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges MIRROR: a whitespace-and-".md"-padded related_themes entry that still does not resolve after normalization DOES fire (kills a normalization "fix" that degenerates into never reporting anything)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/norm-unresolvable.md', fm: { related_themes: ['  really-does-not-exist.md  '] } },
    ],
  });
  try {
    const hits = checkDanglingEdges(root).filter((f) => f.file.endsWith('norm-unresolvable.md'));
    assert.equal(hits.length, 1, `expected exactly one finding for the unresolvable normalized slug, got ${JSON.stringify(hits)}`);
    assert.match(hits[0].message, /really-does-not-exist/);
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: a bare-scalar (non-array) related_themes value is a DELIBERATE no-op — zero findings even though the slug does not exist anywhere (kills an unreviewed "improvement" that starts scanning scalar related_themes and silently diverges the lint from the graph it audits)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    // Planted directly on disk: `related_themes: some-slug` as a bare YAML
    // scalar (NOT `related_themes: [some-slug]`) — buildBrainFixture's
    // ThemeSpec is typed to `string[]` and always emits the array form, so
    // this shape can only be produced by hand-writing the file.
    //
    // WHY this is a deliberate pin, not an accidental gap:
    //   (a) MIRRORS orchestrator/kb-graph.ts:327-329's own
    //       `Array.isArray(parsed?.data.related_themes) ? (...) : []` guard —
    //       the graph builder treats a non-array related_themes as "no edges
    //       declared" and never attempts to resolve it. If this lint check
    //       scanned scalar values, it would report an edge as "broken" that
    //       the graph never tried to build in the first place — going
    //       STRICTER than the graph, not matching it.
    //   (b) Known blind spot, not an oversight: a genuinely-scalar
    //       `related_themes: some-slug` (vs. the array form) is a real
    //       authoring mistake the graph silently drops today with zero
    //       signal anywhere. It is a filed, tracked gap (this test IS that
    //       tracking record, alongside the `danglingEdgeFindings`
    //       "tolerate missing/absent/non-array" comment a few lines above in
    //       cli/brain-lint.ts and the sibling cross-KB gap documented in
    //       `checkDanglingEdges`'s own doc comment). Zero occurrences exist
    //       in the live 364-theme corpus as of 2026-08-14, which is why it
    //       is parked rather than fixed now.
    //   (c) EXPIRY CONDITION (immutable-gates: a deliberately-green gap-pin
    //       must document when it should be revisited) — THIS TEST MUST
    //       FLIP the moment orchestrator/kb-graph.ts starts coercing or
    //       otherwise honouring a scalar `related_themes` value into a real
    //       edge (i.e. the day the `Array.isArray(...)` guard at
    //       kb-graph.ts:327 is loosened/removed). Until then, staying a
    //       no-op here is correct; going stricter than the graph is the bug.
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'scalar-related.md'),
      '---\ntitle: Scalar Related\ndescription: none.\ncategory: pattern\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\nrelated_themes: definitely-does-not-exist-anywhere\n---\n\n# Scalar Related\n',
    );
    const findings = checkDanglingEdges(root).filter((f) => f.file.endsWith('scalar-related.md'));
    assert.equal(
      findings.length,
      0,
      `a bare-scalar related_themes value must be a no-op (mirrors kb-graph.ts:327-329's Array.isArray guard), got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: two themes whose titles normalize to the same string are flagged as a pair (kills an implementation that only does exact-string title equality, no normalization)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/dup-a.md', fm: { title: 'The Same Thing' } },
      { path: 'cycles/themes/dup-b.md', fm: { title: 'the same thing!' } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root);
    assert.equal(findings.length, 1, `expected exactly one pair finding, got ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'checkDuplicateThemes');
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: keywords Jaccard >= 0.8 (8/10, distinct titles) fires (kills an implementation that never implements the keywords clause and only checks titles)', () => {
  const common = ['kw-1', 'kw-2', 'kw-3', 'kw-4', 'kw-5', 'kw-6', 'kw-7', 'kw-8'];
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/kwdup-a.md', fm: { keywords: [...common, 'only-a'] } },
      { path: 'cycles/themes/kwdup-b.md', fm: { keywords: [...common, 'only-b'] } },
    ],
  });
  try {
    // Precondition: distinct (default) titles, so a title-only implementation
    // could not accidentally pass this test.
    const findings = checkDuplicateThemes(root);
    const hits = findings.filter(
      (f) => f.file.endsWith('kwdup-a.md') || f.file.endsWith('kwdup-b.md'),
    );
    assert.equal(hits.length, 1, `expected exactly one pair finding (8/10 = 0.8 Jaccard), got ${JSON.stringify(findings)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes NEGATIVE: two themes sharing only 1 of 4 keywords (Jaccard ~0.14) and distinct titles produce zero findings (kills a too-loose Jaccard threshold)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/lowj-a.md', fm: { keywords: ['w1', 'w2', 'w3', 'w4'] } },
      { path: 'cycles/themes/lowj-b.md', fm: { keywords: ['w1', 'x2', 'x3', 'x4'] } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root).filter(
      (f) => f.file.endsWith('lowj-a.md') || f.file.endsWith('lowj-b.md'),
    );
    assert.equal(findings.length, 0, `low-overlap keyword sets must not be flagged, got ${JSON.stringify(findings)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes NEGATIVE: two themes with 2 identical keywords each (below the >=3 minimum) and distinct titles produce zero findings (kills a too-loose "any keyword overlap" implementation that ignores the minimum-declared-keywords floor)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/thin-a.md', fm: { keywords: ['p1', 'p2'] } },
      { path: 'cycles/themes/thin-b.md', fm: { keywords: ['p1', 'p2'] } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root).filter(
      (f) => f.file.endsWith('thin-a.md') || f.file.endsWith('thin-b.md'),
    );
    assert.equal(
      findings.length,
      0,
      `identical-but-thin (2-keyword) sets are below the >=3 minimum and must not be flagged, got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: DUPLICATE_KEYWORD_MIN_DECLARED boundary — exactly 3 declared keywords each with a qualifying Jaccard DOES fire, exactly 2 declared keywords each (otherwise identical) does NOT (kills mutating the ">=3" floor comparisons to ">3")', () => {
  const root = buildBrainFixture({
    themes: [
      // Exactly 3 keywords each, identical sets -> Jaccard 3/3 = 1.0 (>= 0.8),
      // landing exactly ON the >=3-declared floor. Distinct default titles
      // rule out a title-collision false positive.
      { path: 'cycles/themes/floor3-a.md', fm: { keywords: ['f1', 'f2', 'f3'] } },
      { path: 'cycles/themes/floor3-b.md', fm: { keywords: ['f1', 'f2', 'f3'] } },
      // Exactly 2 keywords each (one below the floor), identical sets ->
      // Jaccard 1.0 but below the >=3-declared floor -> must NOT fire.
      { path: 'cycles/themes/floor2-a.md', fm: { keywords: ['g1', 'g2'] } },
      { path: 'cycles/themes/floor2-b.md', fm: { keywords: ['g1', 'g2'] } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root);
    const at3 = findings.filter((f) => f.file.endsWith('floor3-a.md') || f.file.endsWith('floor3-b.md'));
    const at2 = findings.filter((f) => f.file.endsWith('floor2-a.md') || f.file.endsWith('floor2-b.md'));
    assert.equal(at3.length, 1, `exactly-3-declared-keywords pair AT the floor must fire, got ${JSON.stringify(at3)}`);
    assert.equal(at2.length, 0, `exactly-2-declared-keywords pair BELOW the floor must not fire, got ${JSON.stringify(at2)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: reports exactly ONE finding per pair, on the lexicographically-LATER path, with the partner file named in the message (kills a double-reporting implementation that emits one finding per file)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/aaa-first.md', fm: { title: 'Lexicographic Duplicate' } },
      { path: 'cycles/themes/zzz-second.md', fm: { title: 'lexicographic duplicate' } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root).filter(
      (f) => f.file.endsWith('aaa-first.md') || f.file.endsWith('zzz-second.md'),
    );
    assert.equal(findings.length, 1, `expected exactly ONE finding for the pair (not one per file), got ${JSON.stringify(findings)}`);
    assert.ok(
      findings[0].file.endsWith('zzz-second.md'),
      `finding must be filed on the lexicographically-later path (zzz-second.md), got ${findings[0].file}`,
    );
    assert.match(
      findings[0].message,
      /aaa-first\.md/,
      `message must name the partner file (aaa-first.md), got: ${findings[0].message}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: two themes declaring the SAME recurrence series are records, not duplicates', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/2026-06-21-scratch-files.md', fm: { title: 'Gitignored scratch files', recurrence: 'gitignored-scratch-files' } },
      { path: 'cycles/themes/2026-06-22-scratch-files-third-cycle.md', fm: { title: 'Gitignored scratch files', recurrence: 'gitignored-scratch-files' } },
    ],
  });
  try {
    assert.deepEqual(checkDuplicateThemes(root), []);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: an UNDECLARED near-duplicate pair still flags (the check is not weakened)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/a-thing.md', fm: { title: 'Gitignored scratch files' } },
      { path: 'cycles/themes/b-thing.md', fm: { title: 'Gitignored scratch files' } },
    ],
  });
  try {
    assert.equal(checkDuplicateThemes(root).length, 1);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: themes declaring DIFFERENT recurrence series still flag each other', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/x-thing.md', fm: { title: 'Gitignored scratch files', recurrence: 'series-one' } },
      { path: 'cycles/themes/y-thing.md', fm: { title: 'Gitignored scratch files', recurrence: 'series-two' } },
    ],
  });
  try {
    assert.equal(checkDuplicateThemes(root).length, 1);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: a recurrence declaration exempts only its own series, never the declaring theme wholesale', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/p-one.md', fm: { title: 'Gitignored scratch files', recurrence: 'gitignored-scratch-files' } },
      { path: 'cycles/themes/p-two.md', fm: { title: 'Gitignored scratch files', recurrence: 'gitignored-scratch-files' } },
      { path: 'cycles/themes/q-undeclared.md', fm: { title: 'Gitignored scratch files' } },
    ],
  });
  try {
    // The two series records do not flag each other; both still flag against
    // the undeclared third theme.
    assert.equal(checkDuplicateThemes(root).length, 2);
  } finally {
    cleanup(root);
  }
});
