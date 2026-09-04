import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deriveSessionTranscript, deriveSessionArtifact } from '../../studio/session-transcript.ts';
import type { SessionKindDescriptor } from '../../studio/session-kinds.ts';

import { architectDescriptor, authoringDescriptor, instructionsDescriptor, makeTmpDir, okTurns, parseManifest, projectBrainDescriptor, writeJson, writeStagingFile } from './test-fixtures/transcript-test-helpers.ts';

// ===========================================================================
// Ordering — a 2-round architect fixture (AT-19)
// ===========================================================================

describe('deriveSessionTranscript — ordering (2-round architect fixture)', () => {
  it('AT-19: idea → r1 agent → r1 operator → r2 agent → r2 operator → pending agent → feedback operator, exact index+source pins', () => {
    const sessionDir = makeTmpDir('transcript-order-');
    writeFileSync(join(sessionDir, 'idea.md'), 'Build a thing.\n', 'utf8');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, answers: [{ question: 'What kind of thing?', answer: 'A widget.' }] },
      { round: 2, answers: [{ question: 'What color?', answer: 'Blue.' }] },
    ]);
    writeJson(sessionDir, 'questions.json', [{ question: 'Any constraints?', header: 'Constraints', options: [{ label: 'None', description: 'No constraints' }] }]);
    writeFileSync(join(sessionDir, 'feedback.md'), 'Please add a budget section.\n', 'utf8');

    // AT-amendment-2: the pending questions.json turn now requires an
    // explicit phase === 'awaiting-answers' — the fixture's questions.json
    // is genuinely pending, so this is the real phase a live session would
    // carry at this checkpoint.
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-answers' });
    const turns = okTurns(result);

    assert.equal(turns.length, 7, `expected 7 turns, got: ${JSON.stringify(turns)}`);
    assert.deepEqual(turns.map((t) => t.index), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(
      turns.map((t) => [t.role, t.source]),
      [
        ['operator', 'idea.md'],
        ['agent', 'answers.json#round-1'],
        ['operator', 'answers.json#round-1'],
        ['agent', 'answers.json#round-2'],
        ['operator', 'answers.json#round-2'],
        ['agent', 'questions.json'],
        ['operator', 'feedback.md'],
      ],
    );
    assert.equal(turns[0].text.trim(), 'Build a thing.');
    assert.equal(turns[1].text, 'What kind of thing?');
    assert.equal(turns[2].text, 'A widget.');
    assert.equal(turns[3].text, 'What color?');
    assert.equal(turns[4].text, 'Blue.');
    assert.equal(turns[5].text, 'Any constraints?');
    assert.equal(turns[6].text.trim(), 'Please add a budget section.');
  });
});

// ===========================================================================
// Stage defaulting is declared, not hardcoded (AT-20)
// ===========================================================================

describe('deriveSessionTranscript — stage defaulting comes from the descriptor', () => {
  it('AT-20: a descriptor whose defaultStage is a DIFFERENT token ("demo") — every turn follows it, not a hardcoded value', () => {
    const sessionDir = makeTmpDir('transcript-stage-');
    writeFileSync(join(sessionDir, 'prompt.md'), 'A brief.\n', 'utf8');

    const descriptor = instructionsDescriptor({ stages: ['demo'], defaultStage: 'demo' });
    const turns = okTurns(deriveSessionTranscript({ descriptor, sessionDir, phase: 'drafting' }));

    assert.equal(turns.length, 1);
    assert.equal(turns[0].stage, 'demo', 'the turn stage must come from descriptor.defaultStage, not a literal default baked into the derivation');
  });
});

// ===========================================================================
// Fail-closed on an unknown stage marker + the valid multi-stage companion
// (AT-21, AT-22)
// ===========================================================================

describe('deriveSessionTranscript — stage machinery is genuinely exercised (fail-closed + valid multi-stage)', () => {
  it('AT-21: a checkpoint stage marker OUTSIDE the descriptor\'s declared stages → {ok:false}, never defaults, never drops the turn, never returns ok:true', () => {
    const sessionDir = makeTmpDir('transcript-badstage-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, stage: 'no-such-stage', answers: [{ question: 'Q1?', answer: 'A1.' }] },
    ]);
    const descriptor = architectDescriptor({ stages: ['roadmap'], defaultStage: 'roadmap' });
    const result = deriveSessionTranscript({ descriptor, sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false, 'an unknown stage marker must fail closed, not default or silently drop the turn');
    assert.ok(result.error && result.error.message.includes('no-such-stage'), 'error must name the offending value');
    assert.ok(result.error && result.error.message.includes('roadmap'), 'error must name the descriptor\'s allowed stage set');
  });

  it('AT-22: a valid multi-stage descriptor with turns tagged across ALL its stages — the machinery genuinely works even though every SHIPPED kind is single-stage', () => {
    const sessionDir = makeTmpDir('transcript-multistage-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, stage: 'contract', answers: [{ question: 'Contract Q?', answer: 'Contract A.' }] },
      { round: 2, stage: 'demo', answers: [{ question: 'Demo Q?', answer: 'Demo A.' }] },
      { round: 3, stage: 'roadmap', answers: [{ question: 'Roadmap Q?', answer: 'Roadmap A.' }] },
    ]);
    const descriptor = architectDescriptor({ stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'], defaultStage: 'contract' });
    const turns = okTurns(deriveSessionTranscript({ descriptor, sessionDir, phase: 'awaiting-verdict' }));

    assert.equal(turns.length, 6, `expected 3 rounds × 2 turns, got: ${JSON.stringify(turns)}`);
    assert.deepEqual(
      turns.map((t) => t.stage),
      ['contract', 'contract', 'demo', 'demo', 'roadmap', 'roadmap'],
    );
  });
});

// ===========================================================================
// Empty session dir — honest, non-empty sourcesScanned (AT-23)
// ===========================================================================

describe('deriveSessionTranscript — empty session honesty', () => {
  it('AT-23: an empty session dir → {ok:true, turns:[]} with sourcesScanned NON-empty, naming the files it looked for', () => {
    const sessionDir = makeTmpDir('transcript-empty-');
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' });
    assert.ok(result.ok);
    assert.deepEqual(result.turns, []);
    assert.ok(Array.isArray(result.sourcesScanned) && result.sourcesScanned.length > 0, 'sourcesScanned must never be silently empty — it names what was scanned even when nothing was found');
    for (const name of ['idea.md', 'answers.json', 'questions.json', 'feedback.md']) {
      assert.ok(result.sourcesScanned.some((s) => s.includes(name)), `sourcesScanned must name "${name}"`);
    }
    // W8-B3 (ON-5): scanned names what we LOOKED for; found names what was
    // there. An empty dir must report the second as empty, never conflate them.
    assert.deepEqual([...result.sourcesFound], []);
  });
});

// ===========================================================================
// Malformed answers.json — fail closed, never fabricate (AT-24..27)
// ===========================================================================

describe('deriveSessionTranscript — malformed answers.json fails closed', () => {
  it('AT-24: answers.json is not an array at all → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-a-');
    writeJson(sessionDir, 'answers.json', { round: 1, answers: [] });
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-25: a round object is missing the "answers" key → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-b-');
    writeJson(sessionDir, 'answers.json', [{ round: 1 }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-26: a round\'s "answers" is not an array (a string) → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-c-');
    writeJson(sessionDir, 'answers.json', [{ round: 1, answers: 'not-an-array' }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-27: an answer entry\'s "question" is not a string (a number) → {ok:false}, never a turn with undefined/empty text', () => {
    const sessionDir = makeTmpDir('transcript-malformed-d-');
    writeJson(sessionDir, 'answers.json', [{ round: 1, answers: [{ question: 42, answer: 'A1.' }] }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false, 'a non-string question must fail closed, never surface as a turn with undefined/empty text');
  });
});

// ===========================================================================
// project-brain — honestly ONE turn, no invented interview (AT-28)
// ===========================================================================

describe('deriveSessionTranscript — project-brain has no interview', () => {
  it('AT-28: a project-brain session dir with only prompt.md → exactly ONE turn, never a fabricated agent turn', () => {
    const sessionDir = makeTmpDir('transcript-pbrain-');
    writeFileSync(join(sessionDir, 'prompt.md'), 'Seed the brain from the current code.\n', 'utf8');
    const turns = okTurns(deriveSessionTranscript({ descriptor: projectBrainDescriptor(), sessionDir, phase: 'analyzing' }));
    assert.equal(turns.length, 1, `project-brain must be honestly one turn, got: ${JSON.stringify(turns)}`);
    assert.equal(turns[0].role, 'operator');
    assert.equal(turns[0].source, 'prompt.md');
    assert.equal(turns[0].stage, 'brain');
  });
});

// ===========================================================================
// deriveSessionArtifact — roadmap-draft (AT-29, AT-30)
// ===========================================================================


describe('deriveSessionArtifact — roadmap-draft (real serializeManifest fixtures)', () => {
  it('AT-30: zero manifests → an honest empty payload naming what was scanned, never a fabricated row', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-empty-');
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: architectDescriptor(), sessionDir }) as {
      rows: unknown[];
      sourcesScanned: string[];
    };
    assert.deepEqual(artifact.rows, []);
    assert.ok(Array.isArray(artifact.sourcesScanned) && artifact.sourcesScanned.length > 0);
    assert.ok(artifact.sourcesScanned.some((s) => s.includes('manifests')));
  });
});

// ===========================================================================
// deriveSessionArtifact — roadmap-draft rows carry cross-initiative
// dependency edges (R4-15, AT-75, AT-76). `RoadmapDraftRow` gains a fifth
// field, `dependsOn: string[]`, sourced from the manifest's
// `depends_on_initiatives` (already parsed by `parseManifest`,
// packages/flows/manifest.ts:73, but dropped on the floor by
// `deriveRoadmapDraft` today). Absent key ⇒ []. This layer never filters
// against the draft's own row set, never sorts, never de-duplicates — that
// is `dependencyDagView`'s (apps/studio/lib/dependency-dag.ts) job, a layer up.
// ===========================================================================

describe('deriveSessionArtifact — roadmap-draft rows carry dependsOn (R4-15)', () => {
  it('AT-31: returns the real AGENTS.draft.md body byte-for-byte, including trailing newline', () => {
    const sessionDir = makeTmpDir('artifact-md-');
    const body = '# AGENTS.md\n\nSome instructions.\n\n- a\n- b\n';
    writeFileSync(join(sessionDir, 'AGENTS.draft.md'), body, 'utf8');
    const artifact = deriveSessionArtifact({ parseManifest, descriptor: instructionsDescriptor(), sessionDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(artifact.body, body, 'body must be byte-identical, including the trailing newline');
    assert.equal(artifact.hasDraft, true);
  });

  it('AT-32: distinguishes "no draft yet" (missing file, body: null) from an "empty draft" (file exists, empty, body: "")', () => {
    const missingDir = makeTmpDir('artifact-md-missing-');
    const missing = deriveSessionArtifact({ parseManifest, descriptor: instructionsDescriptor(), sessionDir: missingDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(missing.body, null, 'no draft file at all must be null, never "" masquerading as content');
    assert.equal(missing.hasDraft, false);

    const emptyDir = makeTmpDir('artifact-md-empty-');
    writeFileSync(join(emptyDir, 'AGENTS.draft.md'), '', 'utf8');
    const empty = deriveSessionArtifact({ parseManifest, descriptor: instructionsDescriptor(), sessionDir: emptyDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(empty.body, '');
    assert.equal(empty.hasDraft, true, 'an existing-but-empty draft must be distinguishable from "no draft yet"');
  });
});

// ===========================================================================
// deriveSessionArtifact — brain-structure (AT-33)
// ===========================================================================

describe('deriveSessionArtifact — brain-structure (shared PackageFile shape)', () => {
  it('AT-33: themeCount + files count only real .md theme files; a stray non-.md file is excluded, not counted', () => {
    const sessionDir = makeTmpDir('artifact-brain-');
    const themesDir = join(sessionDir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(themesDir, 'alpha.md'), '# Alpha theme\n', 'utf8');
    writeFileSync(join(themesDir, 'beta.md'), '# Beta theme\n', 'utf8');
    writeFileSync(join(themesDir, 'notes.txt'), 'not a theme', 'utf8');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: projectBrainDescriptor(), sessionDir }) as {
      themeCount: number;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.themeCount, 2, 'the stray .txt file must not be counted as a theme');
    assert.equal(artifact.files.length, 2);
    assert.ok(!artifact.files.some((f) => f.path.includes('notes.txt')), 'the stray non-.md file must not appear in files at all');
    assert.ok(artifact.files.some((f) => f.path.includes('alpha.md') && f.body.includes('Alpha theme')));
  });
});

// ===========================================================================
// deriveSessionArtifact — reserved kind (AT-34)
// ===========================================================================

// AT-34 RETARGETED (R4-21, documented edit — T3): this AT used 'file-package'
// as its RESERVED-row example — but file-package is THE row R4-21 flips
// reserved→live (see this file's RED-2a/b/c, below), and per
// session-kinds.test.ts's AT-2 it was already the LAST reserved row in the
// whole vocabulary, so after this round SESSION_ARTIFACT_KINDS carries ZERO
// reserved rows — there is no other genuinely-reserved kind left anywhere to
// build a fresh fixture from. Retargeted (per the task brief's own
// instruction) rather than deleted: the underlying claim this AT protects —
// "an unrecognised artifact kind is never a stub, it throws naming itself" —
// still has a live code path to pin (deriveSessionArtifact's `state ===
// undefined` branch), so this AT now exercises THAT branch via a kind that
// is not, and never was, a member of SESSION_ARTIFACT_KINDS at all — proving
// the same "never a stub" contract without depending on a reserved row that
// no longer exists. GREEN both before and after the R4-21 flip lands (an
// entirely-unknown kind's behaviour is untouched by this round) — kept as
// coverage, not a fresh RED pin; RED-2a/b/c (below) are this round's actual
// RED pins for file-package itself.
describe('deriveSessionArtifact — an unrecognised artifact kind is never a stub', () => {
  it('AT-34 (retargeted): a descriptor whose artifact.kind is not a member of SESSION_ARTIFACT_KINDS at all → throws, naming the unrecognised kind', () => {
    const sessionDir = makeTmpDir('artifact-reserved-');
    const descriptor = architectDescriptor({ artifact: { kind: 'no-such-artifact-kind-at-all-9911' as SessionKindDescriptor['artifact']['kind'], label: 'Unrecognised' } });
    assert.throws(
      () => deriveSessionArtifact({ parseManifest, descriptor, sessionDir }),
      (err: unknown) => { assert.ok(err instanceof Error); assert.match(err.message, /no-such-artifact-kind-at-all-9911/); return true; },
    );
  });
});

// ===========================================================================
// R4-21 — deriveSessionArtifact — file-package (creation-agent authoring
// session). RED-2a/b/c (T3 pins for the OOTB authoring agent / skill-hook
// package producer): file-package flips reserved→live, backed by a real
// derivation reading the session's own `staging/` subdirectory (R4-21 phase
// 2, D2 rename — see writeStagingFile's own header note). Mirrors AT-33
// (brain-structure)'s file-derivation shape and AT-36/37's symlink-escape
// positive-control idiom exactly.
// ===========================================================================

describe('deriveSessionArtifact — file-package (R4-21, creation-agent authoring session)', () => {
  it('RED-2a: kind:"file-package" does NOT throw — returns {kind, label, files} reading the session dir\'s real staging/ files (RED today: deriveFilePackage still reads the phase-1 package/ dir, not staging/ — D2\'s rename has not landed)', () => {
    const sessionDir = makeTmpDir('artifact-filepackage-');
    writeStagingFile(sessionDir, 'SKILL.md', '# Authored Skill\n\nBody.\n');
    writeStagingFile(sessionDir, 'reference.md', 'Supporting reference content.\n');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: authoringDescriptor(), sessionDir }) as {
      kind: string;
      label: string;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.kind, 'file-package');
    assert.equal(artifact.files.length, 2, `expected 2 package files, got: ${JSON.stringify(artifact.files)}`);
    const byPath = new Map(artifact.files.map((f) => [f.path, f.body]));
    assert.equal(byPath.get('SKILL.md'), '# Authored Skill\n\nBody.\n');
    assert.equal(byPath.get('reference.md'), 'Supporting reference content.\n');
  });

  it('RED-2b (containment): a staging/ entry that is a symlink pointing OUTSIDE sessionDir contributes NO file, but a real sibling staged file IS surfaced (positive control) — mirrors safeReadFileInSession\'s existing containment contract exactly (AT-36/37\'s idiom)', () => {
    const outsideDir = makeTmpDir('filepackage-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-PACKAGE-MARKER-6614';
    const secretPath = join(outsideDir, 'secret.md');
    writeFileSync(secretPath, SECRET_MARKER, 'utf8');

    const sessionDir = makeTmpDir('filepackage-escape-session-');
    const stagingDir = join(sessionDir, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    symlinkSync(secretPath, join(stagingDir, 'evil.md'));
    // Positive control: a plain, non-symlinked sibling staged file — MUST
    // surface as a real file.
    const REAL_MARKER = 'REAL-NON-ESCAPED-PACKAGE-CONTENT-2207';
    writeFileSync(join(stagingDir, 'SKILL.md'), REAL_MARKER, 'utf8');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: authoringDescriptor(), sessionDir });
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(SECRET_MARKER), 'the escaped file\'s content must never appear in the derived file-package artifact');
    assert.ok(serialized.includes(REAL_MARKER), 'a plain, non-symlinked sibling staged file MUST still surface — the guard must discriminate, not just refuse to read anything');
  });

  it('RED-2c: the file-package artifact\'s label is threaded verbatim from descriptor.artifact.label, never re-derived', () => {
    const sessionDir = makeTmpDir('filepackage-label-');
    writeStagingFile(sessionDir, 'SKILL.md', '# x\n');
    const descriptor = authoringDescriptor({ artifact: { kind: 'file-package', label: 'Totally Custom Draft Label 8827' } });

    const artifact = deriveSessionArtifact({ parseManifest, descriptor, sessionDir }) as { label: string };
    assert.equal(artifact.label, 'Totally Custom Draft Label 8827', 'label must come from descriptor.artifact.label — never a hardcoded/re-derived string');
  });

  // -------------------------------------------------------------------------
  // T3 fix round (adversarial-review BLOCKER-1, R4-21 phase 1): deriveFilePackage
  // previously scanned only the TOP LEVEL of `staging/` via a flat
  // `listDirEntries` + per-name `safeReadFileInSession` read. A nested file
  // (e.g. `staging/scripts/run.sh` — exactly the shape skills/creation-agent/
  // SKILL.md instructs a hook draft to write: `staging/hook.yaml` +
  // `staging/scripts/run.sh`) has a DIRECTORY as its top-level `staging/`
  // entry name (`scripts`); `readFileSync` on a directory throws EISDIR,
  // caught by the existing try/catch, and the entry was dropped SILENTLY —
  // indistinguishable from a blocked symlink escape (declared-data-fails-open:
  // a real, non-malicious nested file vanishes with no signal). RED-2d pins
  // the fix: the walk must DESCEND a real directory entry, never attempt to
  // read it as a file.
  // -------------------------------------------------------------------------
  it('RED-2d (BLOCKER-1): a staging/ entry that is a real directory (e.g. staging/scripts/) is DESCENDED, not read-as-file — a nested file surfaces with its path relative to staging/, alongside a top-level sibling', () => {
    const sessionDir = makeTmpDir('filepackage-nested-');
    writeStagingFile(sessionDir, 'hook.yaml', 'name: test-hook\ndescription: a draft hook\n');
    writeStagingFile(sessionDir, 'scripts/run.sh', '#!/bin/sh\necho hi\n');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: authoringDescriptor(), sessionDir }) as {
      kind: string;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.kind, 'file-package');
    const byPath = new Map(artifact.files.map((f) => [f.path, f.body]));
    assert.equal(byPath.get('hook.yaml'), 'name: test-hook\ndescription: a draft hook\n', 'the top-level sibling must still surface');
    assert.equal(
      byPath.get('scripts/run.sh'),
      '#!/bin/sh\necho hi\n',
      'the nested file must surface with a path RELATIVE TO staging/ (PackageFile.path convention) — this is RED before D2\'s rename lands (deriveFilePackage still walks the phase-1 package/ dir, not staging/)',
    );
    assert.equal(artifact.files.length, 2, `expected exactly the 2 real files (1 top-level + 1 nested), got: ${JSON.stringify(artifact.files)}`);
  });

  it('RED-2e (BLOCKER-1 containment): a symlink NESTED inside a staging/ subdirectory that points OUTSIDE sessionDir contributes NO file, while a real sibling file in the SAME subdirectory still surfaces (positive control) — proves the recursive walk preserves the module\'s existing symlink-escape guard at every depth, not just the top level (mirrors RED-2b\'s idiom one level deeper)', () => {
    const outsideDir = makeTmpDir('filepackage-nested-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-NESTED-PACKAGE-MARKER-7731';
    const secretPath = join(outsideDir, 'secret.md');
    writeFileSync(secretPath, SECRET_MARKER, 'utf8');

    const sessionDir = makeTmpDir('filepackage-nested-escape-session-');
    const scriptsDir = join(sessionDir, 'staging', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    symlinkSync(secretPath, join(scriptsDir, 'evil.sh'));
    const REAL_MARKER = 'REAL-NESTED-NON-ESCAPED-SCRIPT-9013';
    writeFileSync(join(scriptsDir, 'run.sh'), REAL_MARKER, 'utf8');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: authoringDescriptor(), sessionDir });
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(SECRET_MARKER), 'the nested escaped file\'s content must never appear in the derived file-package artifact');
    assert.ok(serialized.includes(REAL_MARKER), 'a plain, non-symlinked sibling file in the same nested subdirectory MUST still surface');
  });

  // -------------------------------------------------------------------------
  // RED-2f (R4-21 phase 2, D2): the rename is COMPLETE, not additive. A
  // session dir carrying ONLY a leftover `package/` (the phase-1 dirname,
  // never renamed on disk by a real session that started before this phase)
  // must surface NOTHING — proves deriveFilePackage no longer scans `package/`
  // at all, rather than scanning BOTH dirs (which would silently resurrect a
  // stale phase-1 draft alongside a genuine staging/ one, or worse, let a
  // stale package/ masquerade as the session's current draft when staging/
  // is empty). Kills an "additive" fix that keeps the old package/ scan
  // around instead of replacing it.
  // -------------------------------------------------------------------------
  it('RED-2f (D2, rename is complete not additive): a session dir carrying ONLY a leftover package/ (no staging/ at all) surfaces ZERO files — the old dirname is never scanned, not even as a fallback', () => {
    const sessionDir = makeTmpDir('filepackage-leftover-package-');
    const leftoverDir = join(sessionDir, 'package');
    mkdirSync(leftoverDir, { recursive: true });
    writeFileSync(join(leftoverDir, 'SKILL.md'), '# STALE phase-1 leftover — must never surface\n', 'utf8');
    // Precondition, asserted before reading any verdict: the leftover file is
    // really there on disk.
    assert.ok(existsSync(join(leftoverDir, 'SKILL.md')), 'arrange: the leftover package/SKILL.md must exist before deriving');

    const artifact = deriveSessionArtifact({ parseManifest, descriptor: authoringDescriptor(), sessionDir }) as {
      kind: string;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.kind, 'file-package');
    assert.deepEqual(
      artifact.files,
      [],
      `a leftover package/ dir must contribute NOTHING once the session draft dir is staging/ — got: ${JSON.stringify(artifact.files)}`,
    );
  });
});

