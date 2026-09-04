import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveSessionTranscript, deriveSessionArtifact } from '../../studio/session-transcript.ts';

import { architectDescriptor, demoDescriptor, fixtureContractStages, makeTmpDir, okTurns, onboardingDescriptor, parseManifest, projectBrainDescriptor, writeGeneration, writeJson } from './test-fixtures/transcript-test-helpers.ts';

// ===========================================================================
// Traversal / escape — REAL symlinks, realpath is the only thing that catches
// them (a lexical prefix check on the entry's OWN path always passes, since
// the symlink itself lives inside sessionDir) (AT-35, 36, 37)
//
// AT amendment (reviewer finding): each escape AT below now carries a
// POSITIVE CONTROL — a plain, non-symlinked sibling file in the SAME fixture
// whose content MUST appear in the result. Without it, an implementation
// that simply never reads the target directory AT ALL would also pass
// (absence of the secret proves nothing if nothing was ever read). The
// positive control proves the guard actually DISCRIMINATES: real content in,
// escaped content out.
// ===========================================================================

describe('escape via symlink — realpath required, lexical prefix checks are insufficient', () => {
  it('AT-35: deriveSessionTranscript — idea.md is a symlink pointing OUTSIDE sessionDir → the escaped secret content is never returned, but a real sibling file IS (positive control)', () => {
    const outsideDir = makeTmpDir('transcript-escape-outside-');
    const secretPath = join(outsideDir, 'secret.txt');
    const SECRET_MARKER = 'TOP-SECRET-TRANSCRIPT-MARKER-8271';
    writeFileSync(secretPath, SECRET_MARKER, 'utf8');

    const sessionDir = makeTmpDir('transcript-escape-session-');
    // The symlink's OWN path is inside sessionDir — any check of the form
    // `path.startsWith(sessionDir)` on `idea.md`'s path trivially passes.
    // Only resolving via realpathSync(...) reveals the target escapes.
    symlinkSync(secretPath, join(sessionDir, 'idea.md'));
    // Positive control: a plain, non-symlinked sibling file the derivation
    // MUST still read and surface — proves the guard discriminates rather
    // than just refusing to read anything.
    const REAL_MARKER = 'REAL-NON-ESCAPED-FEEDBACK-CONTENT-3391';
    writeFileSync(join(sessionDir, 'feedback.md'), REAL_MARKER + '\n', 'utf8');

    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' });
    const resultText = JSON.stringify(result);
    assert.ok(!resultText.includes(SECRET_MARKER), 'the escaped file\'s content must never appear in the derived transcript');
    assert.ok(resultText.includes(REAL_MARKER), 'a plain, non-symlinked sibling file\'s content MUST still appear — the guard must discriminate, not just refuse to read anything');
  });

  it('AT-37: deriveSessionArtifact (brain-structure) — a themes/ entry is a symlink pointing OUTSIDE sessionDir → its content is never returned, but a real sibling theme IS (positive control)', () => {
    const outsideDir = makeTmpDir('brain-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-THEME-MARKER-9042';
    const secretThemePath = join(outsideDir, 'secret-theme.md');
    writeFileSync(secretThemePath, `# ${SECRET_MARKER}\n`, 'utf8');

    const sessionDir = makeTmpDir('brain-escape-session-');
    const themesDir = join(sessionDir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    symlinkSync(secretThemePath, join(themesDir, 'evil.md'));
    // Positive control: a plain, non-symlinked sibling theme file — MUST
    // surface in files[].
    const REAL_MARKER = 'REAL-NON-ESCAPED-THEME-CONTENT-7714';
    writeFileSync(join(themesDir, 'real-sibling.md'), `# ${REAL_MARKER}\n`, 'utf8');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: projectBrainDescriptor(), sessionDir });
    const artifactText = JSON.stringify(artifact);
    assert.ok(!artifactText.includes(SECRET_MARKER), 'the escaped theme file\'s content must never surface in files[]');
    assert.ok(artifactText.includes(REAL_MARKER), 'a plain, non-symlinked sibling theme file MUST still surface in files[] — the guard must discriminate, not just refuse to read anything');
  });
});

// ===========================================================================
// AT-amendment-2 — questions.json pending-ness is phase-driven, not a
// text-based set-difference (AT-57, AT-58). See the module header for the
// full T2-ratified contract this supersedes.
// ===========================================================================

describe('deriveSessionTranscript — questions.json pending-ness is phase-driven (AT-amendment-2)', () => {
  it('AT-57: a question re-asked VERBATIM in questions.json, phase "awaiting-answers" → the pending agent turn IS present (the defect this pins — the old text-diff logic silently dropped this)', () => {
    const sessionDir = makeTmpDir('transcript-reask-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, answers: [{ question: 'What is the project name?', answer: 'Foo.' }] },
    ]);
    // A genuine, legitimate shape: the interview re-asks the SAME question
    // verbatim (e.g. the prior answer was ambiguous or rejected) — this is
    // NOT a stale leftover, the runner is truly waiting on it again.
    writeJson(sessionDir, 'questions.json', [{ question: 'What is the project name?', header: 'Name', options: [] }]);

    const turns = okTurns(deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-answers' }));
    const pending = turns.find((t) => t.source === 'questions.json');
    assert.ok(pending, `expected a pending agent turn for the verbatim re-ask when phase is "awaiting-answers", got: ${JSON.stringify(turns)}`);
    assert.equal(pending!.role, 'agent');
    assert.equal(pending!.text, 'What is the project name?');
  });

  it('AT-58: a stale questions.json present but phase is NOT "awaiting-answers" → no pending turn is derived, regardless of the question\'s text', () => {
    const sessionDir = makeTmpDir('transcript-stale-question-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, answers: [{ question: 'Q1?', answer: 'A1.' }] },
    ]);
    // A genuinely NEW, never-before-answered question sitting in
    // questions.json — under the OLD text-diff contract this would have been
    // treated as "unanswered" and surfaced as pending; under the phase-driven
    // contract it must NOT, because the session has already moved past the
    // interview (phase: drafting) — this file is stale leftover.
    writeJson(sessionDir, 'questions.json', [{ question: 'A brand new never-answered question?', header: 'New', options: [] }]);

    const turns = okTurns(deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'drafting' }));
    assert.ok(!turns.some((t) => t.source === 'questions.json'), `expected NO pending turn when phase is not "awaiting-answers", got: ${JSON.stringify(turns)}`);
  });
});

// ===========================================================================
// AT-amendment-3, A2 (AT-68, AT-69) — listDirEntries has no containment
// check on the SUBDIRECTORY itself (manifests/ or themes/ being ITSELF a
// symlink to an outside dir). See the module header for the full contract
// and what was empirically verified.
// ===========================================================================

describe('deriveSessionArtifact — a dir-level symlink (manifests/ or themes/ itself) gets realpath containment too (AT-amendment-3, A2)', () => {
  it('AT-68: themes/ is a symlink to an outside dir containing a uniquely-named .md file → brain-structure reports themeCount:0/files:[] and the outside FILENAME never appears anywhere in the result; a real (non-symlinked) themes/ in a separate session still enumerates correctly (positive control)', () => {
    const outsideThemesDir = makeTmpDir('brain-dirsymlink-outside-');
    const OUTSIDE_FILENAME_MARKER = 'UNIQUELY-NAMED-OUTSIDE-THEME-FILE-4471.md';
    writeFileSync(join(outsideThemesDir, OUTSIDE_FILENAME_MARKER), '# outside theme\n', 'utf8');

    const escapedSessionDir = makeTmpDir('brain-dirsymlink-session-');
    symlinkSync(outsideThemesDir, join(escapedSessionDir, 'themes'));

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: projectBrainDescriptor(), sessionDir: escapedSessionDir }) as {
      themeCount: number;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.themeCount, 0, `an escaping themes/ dir-symlink must be treated as absent (empty), got: ${JSON.stringify(artifact)}`);
    assert.deepEqual(artifact.files, []);
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_FILENAME_MARKER), `the outside directory's real FILENAME must never appear anywhere in the result (not just its body), got: ${serialized}`);

    // Positive control: a real, non-symlinked themes/ in a SEPARATE session
    // still enumerates correctly — proves the fix (once applied) discriminates
    // rather than blocking every themes/ dir outright.
    const cleanSessionDir = makeTmpDir('brain-dirsymlink-clean-');
    mkdirSync(join(cleanSessionDir, 'themes'), { recursive: true });
    writeFileSync(join(cleanSessionDir, 'themes', 'real-theme.md'), '# a real theme\n', 'utf8');
    const cleanArtifact = deriveSessionArtifact({ parseManifest, descriptor: projectBrainDescriptor(), sessionDir: cleanSessionDir }) as {
      themeCount: number;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(cleanArtifact.themeCount, 1, 'a real, non-symlinked themes/ dir must still enumerate correctly');
    assert.ok(cleanArtifact.files.some((f) => f.path.includes('real-theme.md')));
  });

  it('R4-16 AT-10: number comes from meta.json.iteration, never array/directory position — generations sort ascending by number', () => {
    const sessionDir = makeTmpDir('gengallery-order-');
    writeGeneration(sessionDir, 5, { iteration: 5 });
    writeGeneration(sessionDir, 2, { iteration: 2 });
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(
      artifact.generations.map((g) => g.number),
      [2, 5],
      'kills an implementation that numbers by directory name / array position instead of reading meta.json.iteration',
    );
  });

  it('R4-16 AT-11: a generation dir whose meta.json is missing/unreadable/not JSON contributes NO generation — a visible gap, never a renumbered sequence', () => {
    const sessionDir = makeTmpDir('gengallery-gap-');
    writeGeneration(sessionDir, 1, { iteration: 1 });
    writeGeneration(sessionDir, 2, { metaRaw: 'not valid json {{{' });
    writeGeneration(sessionDir, 3, { iteration: 3 });
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(
      artifact.generations.map((g) => g.number),
      [1, 3],
      'positional numbering would (wrongly) report [1, 2] — this pins the visible GAP, not a renumber',
    );
  });

  it('R4-16 AT-12: a generation whose meta.json is missing "iteration" entirely (or non-numeric) also contributes no generation, same as unreadable', () => {
    const sessionDir = makeTmpDir('gengallery-bad-iteration-');
    writeGeneration(sessionDir, 1, { iteration: 1 });
    writeGeneration(sessionDir, 2, {
      metaRaw: JSON.stringify({ createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x' /* no "iteration" at all */ }),
    });
    writeGeneration(sessionDir, 3, {
      metaRaw: JSON.stringify({ iteration: 'three', createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x' }),
    });
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(artifact.generations.map((g) => g.number), [1], 'a missing or non-numeric "iteration" must never fabricate a generation row');
  });

  it('R4-16 AT-13: items are the real files present in the generation dir, EXCLUDING meta.json, sorted by filename', () => {
    const sessionDir = makeTmpDir('gengallery-items-');
    writeGeneration(sessionDir, 1, { iteration: 1, files: { 'SKILL.md': '# s', 'DEMO.html': '<html/>', 'notes.txt': 'stray file' } });
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ items: Array<{ path: string; kind: string }> }> };
    const paths = artifact.generations[0].items.map((i) => i.path);
    assert.deepEqual(paths, ['DEMO.html', 'SKILL.md', 'notes.txt'], 'sorted by filename; a non-html/md file is still a real item (kind "file"), never dropped');
    assert.ok(!paths.includes('meta.json'), 'meta.json must never appear as an item — it is metadata, not gallery content');
  });

  it('R4-16 AT-14 (mandatory adversarial AT — bytes-from-file-not-meta): bytes is the REAL byte length read from disk, never a number copied from meta.json — a plausible-but-wrong metadata hint must not leak through', () => {
    const sessionDir = makeTmpDir('gengallery-bytes-');
    const dir = join(sessionDir, 'generations', '1');
    mkdirSync(dir, { recursive: true });
    const demoBody = '<html>only 27 bytes here</html>'; // a real, independently-computable length
    writeFileSync(join(dir, 'DEMO.html'), demoBody, 'utf8');
    // A plausible-but-WRONG size-ish field smuggled onto meta.json — no such
    // field exists in the declared meta.json contract; an implementation
    // that trusts ANY such hint instead of the real file's length is what
    // this kills.
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ iteration: 1, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x', bytes: 999999, sizeHint: 999999 }),
      'utf8',
    );
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ items: Array<{ path: string; bytes: number }> }> };
    const demoItem = artifact.generations[0].items.find((i) => i.path === 'DEMO.html')!;
    const realBytes = Buffer.byteLength(demoBody, 'utf8');
    assert.equal(demoItem.bytes, realBytes, `bytes must be the REAL file length (${realBytes}), not the fabricated metadata hint (999999)`);
  });

  it('R4-16 AT-15: an empty/absent generations/ dir yields an honest empty payload naming what was scanned (including the found count) — never a bare pane', () => {
    const sessionDir = makeTmpDir('gengallery-empty-');
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: unknown[]; sourcesScanned: string[] };
    assert.deepEqual(artifact.generations, []);
    assert.ok(Array.isArray(artifact.sourcesScanned) && artifact.sourcesScanned.length > 0, 'sourcesScanned must never be silently empty');
    assert.ok(artifact.sourcesScanned.some((s) => s.includes('generations')), 'sourcesScanned must name "generations"');
    assert.ok(artifact.sourcesScanned.some((s) => /\b0\b/.test(s)), 'sourcesScanned must report the found count (0), so an empty gallery reads "scanned N, found none"');
  });

  it('R4-16 AT-16: deriveSessionArtifact dispatches "generation-gallery" to a real derivation carrying the descriptor\'s declared label — mirrors the label-threading contract every other live kind already honours', () => {
    const sessionDir = makeTmpDir('gengallery-dispatch-');
    writeGeneration(sessionDir, 1, { iteration: 1 });
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { kind: string; label: string };
    assert.equal(artifact.kind, 'generation-gallery');
    assert.equal(artifact.label, 'Demo generations');
  });
});

// ===========================================================================
// R4-16 (mandatory adversarial AT — traversal, real escape attempts) —
// generations/ (and each generations/<n>/) must be realpath-contained the
// SAME way manifests/ and themes/ already are (AT-36/37/68/69's pattern).
// ===========================================================================

describe('deriveSessionArtifact — generation-gallery traversal escapes (R4-16)', () => {
  it('R4-16 AT-17: generations/ itself is a symlink to an outside dir → the gallery is empty, and nothing from outside is named or counted', () => {
    const outsideDir = makeTmpDir('gengallery-escape-outside-');
    const OUTSIDE_MARKER = 'OUTSIDE-GENERATIONS-DIR-MARKER-5521';
    mkdirSync(join(outsideDir, '1'), { recursive: true });
    writeFileSync(
      join(outsideDir, '1', 'meta.json'),
      JSON.stringify({ iteration: 1, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: OUTSIDE_MARKER }),
      'utf8',
    );

    const sessionDir = makeTmpDir('gengallery-escape-session-');
    symlinkSync(outsideDir, join(sessionDir, 'generations'));

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: unknown[]; sourcesScanned: string[] };
    assert.deepEqual(artifact.generations, [], 'an escaping generations/ dir-symlink must be treated as absent, exactly like manifests/themes (AT-68/69)');
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), 'outside content must never surface anywhere in the result');
  });

  it('R4-16 AT-18: generations/2 is a symlink to an outside dir → that generation is absent, while a real generations/1 STILL renders (positive control — the guard must discriminate, not just refuse to read anything)', () => {
    const outsideDir = makeTmpDir('gengallery-escape2-outside-');
    const OUTSIDE_MARKER = 'OUTSIDE-GENERATION-2-MARKER-8834';
    writeFileSync(
      join(outsideDir, 'meta.json'),
      JSON.stringify({ iteration: 2, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: OUTSIDE_MARKER }),
      'utf8',
    );
    writeFileSync(join(outsideDir, 'DEMO.html'), `<html>${OUTSIDE_MARKER}</html>`, 'utf8');

    const sessionDir = makeTmpDir('gengallery-escape2-session-');
    mkdirSync(join(sessionDir, 'generations'), { recursive: true });
    writeGeneration(sessionDir, 1, { iteration: 1 }); // real, non-symlinked sibling
    symlinkSync(outsideDir, join(sessionDir, 'generations', '2'));

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(
      artifact.generations.map((g) => g.number),
      [1],
      'the escaping generation 2 must be absent, but the real generation 1 must still render',
    );
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), 'outside content must never surface');
  });

  it('R4-16 AT-19: a symlinked FILE inside a real generation dir, pointing outside sessionDir → that ONE item is not surfaced, but the generation itself still renders its other real items (positive control)', () => {
    const outsideDir = makeTmpDir('gengallery-escape3-outside-');
    const OUTSIDE_MARKER = 'OUTSIDE-ITEM-CONTENT-MARKER-2290';
    const secretPath = join(outsideDir, 'secret.html');
    writeFileSync(secretPath, `<html>${OUTSIDE_MARKER}</html>`, 'utf8');

    const sessionDir = makeTmpDir('gengallery-escape3-session-');
    const gdir = join(sessionDir, 'generations', '1');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'DEMO.html'), '<html>real demo</html>', 'utf8');
    writeFileSync(
      join(gdir, 'meta.json'),
      JSON.stringify({ iteration: 1, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x' }),
      'utf8',
    );
    symlinkSync(secretPath, join(gdir, 'evil.html'));

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ items: Array<{ path: string }> }> };
    const paths = artifact.generations[0].items.map((i) => i.path);
    assert.ok(paths.includes('DEMO.html'), 'a real, non-symlinked sibling item MUST still surface — the guard must discriminate, not just refuse to read the whole generation');
    assert.ok(!paths.includes('evil.html'), 'the symlinked item must not be surfaced at all, under any name');
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), "the escaped file's content must never appear in the result");
  });
});

// ===========================================================================
// R4-17 — deriveSessionArtifact — contract-buildout. D4: `contract-buildout`
// consumes ALREADY-DERIVED, already-guarded `contractStages` rows passed in
// by the caller (the route derives them via packages/projects/contract-stages.ts's
// deriveContractStages, which lives OUTSIDE this module's containment
// contract — it reads the PROJECT tree, not sessionDir). This module's own
// "may not read outside sessionDir" invariant is NOT relaxed: it does zero
// fs work for this kind, full stop — it just threads the supplied rows +
// the descriptor's label onto the typed artifact shape, and THROWS when
// contractStages is absent (never a silently empty/defaulted artifact).
// TEST-FIRST PIN: `contract-buildout` is still `reserved` in the real,
// unmodified session-kinds.ts today — every test below currently throws
// inside deriveSessionArtifact's own `state === 'reserved'` gate before ever
// reaching the case, exactly like R4-16's generation-gallery block did at
// ITS branch base (see that block's own header note for the precedent).
// ===========================================================================

describe('deriveSessionArtifact — contract-buildout (R4-17)', () => {
  it('R4-17 AT-1: contractStages supplied → returns {kind, label, stages, sourcesScanned} — label from descriptor.artifact.label (never re-derived), stages threaded VERBATIM (not re-sorted, not filtered)', () => {
    const sessionDir = makeTmpDir('contractbuildout-supplied-');
    const stages = fixtureContractStages();
    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: onboardingDescriptor(),
      sessionDir,
      contractStages: stages,
    } as Parameters<typeof deriveSessionArtifact>[0] & { contractStages: typeof stages }) as {
      kind: string;
      label: string;
      stages: typeof stages;
      sourcesScanned: string[];
    };
    assert.equal(artifact.kind, 'contract-buildout');
    assert.equal(artifact.label, 'Contract build-out', 'label must come from descriptor.artifact.label — never a hardcoded/re-derived string');
    assert.deepEqual(artifact.stages, stages, 'the supplied rows must round-trip VERBATIM — this module performs no re-derivation, re-sorting, or filtering of them');
  });

  it('R4-17 AT-2: contractStages ABSENT → THROWS a named error, never returns an empty/defaulted artifact (D4\'s binding rule)', () => {
    const sessionDir = makeTmpDir('contractbuildout-missing-');
    assert.throws(
      () => deriveSessionArtifact({ parseManifest, descriptor: onboardingDescriptor(), sessionDir }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /contractStages/i, `error must name the missing input, got: ${err.message}`);
        return true;
      },
      'an implementation that defaults to an empty stages:[] artifact instead of throwing is exactly the defect this pins',
    );
  });

  it('R4-17 AT-3 (D4 — no fs read outside sessionDir, or ANYWHERE, for this kind): a sessionDir that does not even EXIST on disk still succeeds and returns the supplied rows unchanged — proves the module performs ZERO filesystem work for contract-buildout', () => {
    const nonExistentSessionDir = join(tmpdir(), 'contract-buildout-does-not-exist-on-disk-8827');
    const stages = fixtureContractStages();
    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: onboardingDescriptor(),
      sessionDir: nonExistentSessionDir,
      contractStages: stages,
    } as Parameters<typeof deriveSessionArtifact>[0] & { contractStages: typeof stages }) as { stages: typeof stages };
    assert.deepEqual(
      artifact.stages,
      stages,
      'a non-existent sessionDir must have NO effect on the result — this module never reads sessionDir at all for contract-buildout (D4); an implementation that tries to read/list sessionDir for this kind would throw or return something different here instead',
    );
  });

  it('R4-17 AT-4: an EMPTY contractStages array (all five stages genuinely absent) is a legitimate, distinct input from "absent altogether" — round-trips as an empty array, never conflated with the missing-input throw of AT-2', () => {
    const sessionDir = makeTmpDir('contractbuildout-empty-');
    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: onboardingDescriptor(),
      sessionDir,
      contractStages: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { contractStages: unknown[] }) as { stages: unknown[] };
    assert.deepEqual(artifact.stages, [], 'an explicitly empty array must be accepted and round-tripped, not treated as "absent" and thrown on');
  });
});

