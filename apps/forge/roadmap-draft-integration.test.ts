/**
 * `deriveRoadmapDraft` against the REAL manifest functions — the integration
 * test for `packages/sessions/studio/roadmap-draft.ts`.
 *
 * These six cases lived in `packages/sessions/studio/session-transcript.test.ts`
 * and carried a `package-layer-order` row for it: they write their fixtures with
 * `serializeManifest` and read back what the product actually produces, and
 * `packages/flows` is rank 5 while `packages/sessions` is rank 4. M4 ruling 83
 * sent them here rather than forcing the row closed, and ruling 91 settled the
 * mechanics. `apps/forge` is unranked assembly and may import both, which is
 * what makes this the honest home.
 *
 * A HAND-ROLLED SERIALIZER IS NOT THE ALTERNATIVE, and that is the whole point
 * of the move: a fixture written by a stand-in lets the test assert a format
 * the product never emits, so it would pass while the real derivation broke.
 * `parseManifest` and `serializeManifest` here are the same functions
 * `apps/forge/session-kind-deps.ts` injects into the architect kind in
 * production.
 *
 * They also land beside the module they exercise now: the same split that took
 * `deriveRoadmapDraft` out of `session-transcript.ts` (ruling 83's row-5
 * obligation) makes these the roadmap-draft module's own tests rather than a
 * corner of the transcript suite's.
 *
 * `deriveSessionArtifact` is driven rather than `deriveRoadmapDraft` directly,
 * deliberately: it is the seam production uses, so the injected-port wiring and
 * the reader port are exercised too, not bypassed.
 */
import { it, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseManifest, serializeManifest } from '@forge/flows/manifest.ts';
import { deriveSessionArtifact } from '@forge/sessions/studio/session-transcript.ts';
import type { SessionKindDescriptor } from '@forge/sessions/studio/session-kinds.ts';

import { realManifest } from './manifest-fixtures.ts';

const createdDirs: string[] = [];
after(() => {
  for (const d of createdDirs) rmSync(d, { recursive: true, force: true });
});

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

/** The architect descriptor, whose artifact kind is `roadmap-draft`. */
function architectDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'architect',
    agent: 'architect',
    title: 'Architect',
    legacyRoutes: ['/architect/[sessionId]', '/architect/[sessionId]/interview'],
    stages: ['roadmap'],
    defaultStage: 'roadmap',
    artifact: { kind: 'roadmap-draft', label: 'Roadmap draft' },
    ...overrides,
  } as SessionKindDescriptor;
}

describe('deriveRoadmapDraft against the real manifest functions', () => {
  it('AT-29: rows are derived from real manifests/*.md files, sorted by filename, fields pinned exactly', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'), serializeManifest(realManifest()), 'utf8');
    writeFileSync(
      join(manifestsDir, 'INIT-2026-01-02-fixture-b.md'),
      serializeManifest(realManifest({ initiative_id: 'INIT-2026-01-02-fixture-b', phase: 'in-flight', origin: 'human-directed' })),
      'utf8',
    );

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir }) as {
      kind: string;
      rows: Array<{ initiativeId: string; project: string; phase: string; origin: string }>;
      sourcesScanned: string[];
    };
    assert.equal(artifact.kind, 'roadmap-draft');
    assert.deepEqual(
      artifact.rows.map((r) => r.initiativeId),
      ['INIT-2026-01-01-fixture-a', 'INIT-2026-01-02-fixture-b'],
    );
    assert.equal(artifact.rows[0].project, 'demoproj');
    assert.equal(artifact.rows[0].phase, 'pending');
    assert.equal(artifact.rows[0].origin, 'architect');
    assert.equal(artifact.rows[1].phase, 'in-flight');
    assert.equal(artifact.rows[1].origin, 'human-directed');
  });

  it('AT-75: a manifest with no depends_on_initiatives yields dependsOn: [] — never undefined, never dropped from the row entirely (today\'s defect)', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-deps-absent-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'), serializeManifest(realManifest()), 'utf8');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir }) as {
      rows: Array<{ initiativeId: string; dependsOn: string[] }>;
    };
    assert.equal(artifact.rows.length, 1);
    assert.deepEqual(artifact.rows[0].dependsOn, [], 'an absent depends_on_initiatives must default to [], never undefined or dropped');
  });

  it('AT-76: depends_on_initiatives round-trips VERBATIM — declared order preserved, and an entry pointing OUTSIDE this session\'s manifest set is never filtered out', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-deps-present-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'), serializeManifest(realManifest()), 'utf8');
    writeFileSync(
      join(manifestsDir, 'INIT-2026-01-02-fixture-b.md'),
      serializeManifest(
        realManifest({
          initiative_id: 'INIT-2026-01-02-fixture-b',
          // Deliberately NOT alphabetically sorted (2026 before 2025) — pins
          // that the deriver preserves DECLARED order, never re-sorts.
          depends_on_initiatives: ['INIT-2026-01-01-fixture-a', 'INIT-2025-06-01-already-merged'],
        }),
      ),
      'utf8',
    );

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir }) as {
      rows: Array<{ initiativeId: string; dependsOn: string[] }>;
    };
    const rowA = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-01-fixture-a')!;
    const rowB = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-02-fixture-b')!;
    assert.ok(rowA, 'row A must be present');
    assert.ok(rowB, 'row B must be present');
    assert.deepEqual(rowA.dependsOn, []);
    assert.deepEqual(
      rowB.dependsOn,
      ['INIT-2026-01-01-fixture-a', 'INIT-2025-06-01-already-merged'],
      'dependsOn must round-trip verbatim: declared order preserved (never sorted), and the outside-set entry ' +
        '(INIT-2025-06-01-already-merged, not present under manifests/) must never be filtered out — an ' +
        'architect draft may legitimately depend on an already-merged initiative outside the draft set',
    );
  });

  // Adversarial-review amendment (2026-08-06), Amendment 2: the fix ruled
  // that de-duplication happens EXACTLY ONCE, in the view model
  // (dependency-dag.ts's DependencyDagNode.deps) — never at this layer. A
  // manifest declaring the SAME dependency twice must still round-trip with
  // the duplicate INTACT: this is the regression guard against the wrong
  // fix (deduping here, at the file-parsing layer, instead of only in the
  // view) — checked and confirmed NOT already covered by AT-75/76 above
  // (neither uses a duplicate entry). GREEN today (session-transcript.ts:484
  // already does a bare passthrough, `dependsOn: manifest.depends_on_initiatives
  // ?? []`, with no dedup) — a characterization pin, not a defect pin: it
  // earns its place because Amendment 2's fix touches a SIBLING module
  // (dependency-dag.ts) implementing the OPPOSITE behaviour (dedup), and a
  // careless implementer "fixing the table" by deduping at the wrong layer
  // instead would silently break this exact invariant.

  it('AT-78: a manifest declaring the SAME dependency twice round-trips with the duplicate INTACT — dependsOn is never de-duplicated at this layer (dedup is the view model\'s job, one layer up)', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-deps-duplicate-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(
      join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'),
      serializeManifest(
        realManifest({
          depends_on_initiatives: ['INIT-2025-06-01-already-merged', 'INIT-2025-06-01-already-merged'],
        }),
      ),
      'utf8',
    );

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir }) as {
      rows: Array<{ initiativeId: string; dependsOn: string[] }>;
    };
    assert.equal(artifact.rows.length, 1);
    assert.deepEqual(
      artifact.rows[0].dependsOn,
      ['INIT-2025-06-01-already-merged', 'INIT-2025-06-01-already-merged'],
      'a duplicate entry must survive verbatim at this layer — de-duplicating here would be the WRONG fix for the table/DAG disagreement',
    );
  });
});

// ===========================================================================
// deriveSessionArtifact — markdown-draft (AT-31, AT-32)
// ===========================================================================

describe('deriveSessionArtifact — markdown-draft (byte-faithful AGENTS.draft.md)', () => {

  it('AT-36: deriveSessionArtifact (roadmap-draft) — a manifests/ entry is a symlink pointing OUTSIDE sessionDir → its content is never returned, but a real sibling manifest IS (positive control)', () => {
    const outsideDir = makeTmpDir('artifact-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-MANIFEST-MARKER-5533';
    const secretManifestPath = join(outsideDir, 'secret-manifest.md');
    writeFileSync(secretManifestPath, serializeManifest(realManifest({ initiative_id: SECRET_MARKER })), 'utf8');

    const sessionDir = makeTmpDir('artifact-escape-session-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    symlinkSync(secretManifestPath, join(manifestsDir, 'evil.md'));
    // Positive control: a plain, non-symlinked sibling manifest — MUST
    // surface as a real row.
    const REAL_MARKER = 'INIT-2026-01-03-real-sibling-manifest';
    writeFileSync(join(manifestsDir, 'real-sibling.md'), serializeManifest(realManifest({ initiative_id: REAL_MARKER })), 'utf8');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir });
    const artifactText = JSON.stringify(artifact);
    assert.ok(!artifactText.includes(SECRET_MARKER), 'the escaped manifest\'s content must never surface as a row');
    assert.ok(artifactText.includes(REAL_MARKER), 'a plain, non-symlinked sibling manifest MUST still surface as a row — the guard must discriminate, not just refuse to read anything');
  });

  it('AT-69: manifests/ is a symlink to an outside dir → roadmap-draft reports rows:[] AND sourcesScanned reports "0 file(s) found" (NOT the escaped directory\'s real file count — this is the part that currently fails); a real (non-symlinked) manifests/ in a separate session still enumerates correctly (positive control)', () => {
    const outsideManifestsDir = makeTmpDir('roadmap-dirsymlink-outside-');
    const OUTSIDE_MARKER = 'INIT-OUTSIDE-DIRSYMLINK-LEAK-9042';
    writeFileSync(join(outsideManifestsDir, 'outside-manifest.md'), serializeManifest(realManifest({ initiative_id: OUTSIDE_MARKER })), 'utf8');

    const escapedSessionDir = makeTmpDir('roadmap-dirsymlink-session-');
    symlinkSync(outsideManifestsDir, join(escapedSessionDir, 'manifests'));

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir: escapedSessionDir }) as {
      rows: unknown[];
      sourcesScanned: string[];
    };
    assert.deepEqual(artifact.rows, [], 'an escaping manifests/ dir-symlink must never contribute a row');
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), 'the escaped manifest\'s content must never surface');
    assert.ok(!serialized.includes('outside-manifest.md'), 'the outside directory\'s real FILENAME must never appear anywhere in the result');
    // The count leak: sourcesScanned must report the dir as EMPTY (treated as
    // absent), not the escaped directory's real file count.
    assert.ok(
      artifact.sourcesScanned.some((s) => s.includes('0 file(s) found')),
      `sourcesScanned must report "0 file(s) found" (the escaping dir treated as absent), got: ${JSON.stringify(artifact.sourcesScanned)}`,
    );

    // Positive control: a real, non-symlinked manifests/ in a SEPARATE
    // session still enumerates correctly.
    const cleanSessionDir = makeTmpDir('roadmap-dirsymlink-clean-');
    const cleanManifestsDir = join(cleanSessionDir, 'manifests');
    mkdirSync(cleanManifestsDir, { recursive: true });
    const REAL_MARKER = 'INIT-2026-01-09-real-manifest';
    writeFileSync(join(cleanManifestsDir, 'real.md'), serializeManifest(realManifest({ initiative_id: REAL_MARKER })), 'utf8');
    const cleanArtifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir: cleanSessionDir }) as {
      rows: Array<{ initiativeId: string }>;
      sourcesScanned: string[];
    };
    assert.deepEqual(cleanArtifact.rows.map((r) => r.initiativeId), [REAL_MARKER]);
    assert.ok(cleanArtifact.sourcesScanned.some((s) => s.includes('1 file(s) found')));
  });
});

// ===========================================================================
// R4-16 — deriveSessionArtifact — generation-gallery (a new LIVE artifact
// kind). TEST-FIRST PIN: `deriveGenerationGallery` does not exist yet, and
// `generation-gallery` is still `reserved` in the real, unmodified
// session-kinds.ts (SESSION_ARTIFACT_KINDS) — every test below currently
// throws inside `deriveSessionArtifact`'s own `state === 'reserved'` gate
// (session-kinds.ts:531), before ever reaching a derivation. That is the
// correct RED: the reserved-kind guard IS the thing R4-16 must flip.
// ===========================================================================

describe('deriveSessionArtifact — generation-gallery (R4-16)', () => {
});
