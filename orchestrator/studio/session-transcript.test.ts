/**
 * Acceptance tests for orchestrator/studio/session-transcript.ts (R2-10,
 * PR1: the session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./session-transcript.ts` import is the
 * expected red).
 *
 * AT numbers continue the flat R2-10 sequence started in
 * orchestrator/studio/session-kinds.test.ts (AT-1..AT-18). This file covers
 * AT-19..AT-37. cli/bridge-studio-sessions.test.ts covers AT-38..AT-48.
 *
 * Design decisions this file pins (see the T3 report for full rationale):
 *
 *   - Derivation is FILE-PRESENCE-DRIVEN, not descriptor.id-driven: it always
 *     scans the same fixed candidate list (idea.md, prompt.md, answers.json,
 *     questions.json, feedback.md) and reacts to whichever exist. This is
 *     what makes project-brain's "honestly one turn" fall out NATURALLY (its
 *     runner never writes answers.json/questions.json/feedback.md — there is
 *     no interview) rather than requiring a hardcoded per-kind branch, and is
 *     also what lets a synthetic, non-shipped descriptor exercise the
 *     multi-stage machinery (AT-21/AT-22) — the module must stay generic
 *     over descriptor shape, per the spec's explicit ask for a working
 *     multi-stage companion case.
 *   - Within one answered interview round, the AGENT turn (the round's
 *     question) and the OPERATOR turn (the round's answer) share the SAME
 *     `source` string, `answers.json#round-N` — both come from literally the
 *     same round object in the same file.
 *   - `AnswerRound` (orchestrator/interactive-session.ts:303) carries no
 *     `stage` field in its documented shape today (every shipped kind is
 *     single-stage, so it never needs one). This module reads an OPTIONAL
 *     `stage` key on the round object when present — a forward-compatible
 *     superset the real runners never populate yet, but which is exactly the
 *     "stage marker" the spec's fail-closed/multi-stage ATs require the
 *     derivation to honor generically. Absent ⇒ descriptor.defaultStage.
 *   - Malformed answers.json (any shape violation, at any level) fails
 *     CLOSED — `{ok:false}` — rather than skipping the bad round and
 *     continuing; this keeps "never fabricate" unambiguous (no partial
 *     transcript with a silently-dropped round).
 *   - `deriveSessionArtifact` throws for a reserved artifact kind.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveSessionTranscript, deriveSessionArtifact } from './session-transcript.ts';
import type { SessionKindDescriptor } from './session-kinds.ts';
import { serializeManifest, type InitiativeManifest } from '../manifest.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

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

function instructionsDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'instructions',
    agent: 'instructions-creator',
    title: 'Instructions',
    legacyRoutes: ['/instructions/[sessionId]'],
    stages: ['instructions'],
    defaultStage: 'instructions',
    artifact: { kind: 'markdown-draft', label: 'AGENTS.md draft' },
    ...overrides,
  } as SessionKindDescriptor;
}

function projectBrainDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'project-brain',
    agent: 'project-brain-builder',
    title: 'Project Brain',
    legacyRoutes: ['/project-brain/[sessionId]'],
    stages: ['brain'],
    defaultStage: 'brain',
    artifact: { kind: 'brain-structure', label: 'Seeded structure' },
    ...overrides,
  } as SessionKindDescriptor;
}

function writeJson(sessionDir: string, name: string, value: unknown): void {
  writeFileSync(join(sessionDir, name), JSON.stringify(value, null, 2), 'utf8');
}

function okTurns(result: ReturnType<typeof deriveSessionTranscript>): Array<{ index: number; role: string; stage: string; text: string; source: string }> {
  assert.equal((result as { ok: boolean }).ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  return (result as unknown as { turns: Array<{ index: number; role: string; stage: string; text: string; source: string }> }).turns;
}

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

    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir });
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
    const turns = okTurns(deriveSessionTranscript({ descriptor, sessionDir }));

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
    const result = deriveSessionTranscript({ descriptor, sessionDir }) as { ok: boolean; error?: { message: string } };
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
    const turns = okTurns(deriveSessionTranscript({ descriptor, sessionDir }));

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
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir }) as {
      ok: true;
      turns: unknown[];
      sourcesScanned: string[];
    };
    assert.equal(result.ok, true);
    assert.deepEqual(result.turns, []);
    assert.ok(Array.isArray(result.sourcesScanned) && result.sourcesScanned.length > 0, 'sourcesScanned must never be silently empty — it names what was scanned even when nothing was found');
    for (const name of ['idea.md', 'answers.json', 'questions.json', 'feedback.md']) {
      assert.ok(result.sourcesScanned.some((s) => s.includes(name)), `sourcesScanned must name "${name}"`);
    }
  });
});

// ===========================================================================
// Malformed answers.json — fail closed, never fabricate (AT-24..27)
// ===========================================================================

describe('deriveSessionTranscript — malformed answers.json fails closed', () => {
  it('AT-24: answers.json is not an array at all → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-a-');
    writeJson(sessionDir, 'answers.json', { round: 1, answers: [] });
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-25: a round object is missing the "answers" key → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-b-');
    writeJson(sessionDir, 'answers.json', [{ round: 1 }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-26: a round\'s "answers" is not an array (a string) → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-c-');
    writeJson(sessionDir, 'answers.json', [{ round: 1, answers: 'not-an-array' }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-27: an answer entry\'s "question" is not a string (a number) → {ok:false}, never a turn with undefined/empty text', () => {
    const sessionDir = makeTmpDir('transcript-malformed-d-');
    writeJson(sessionDir, 'answers.json', [{ round: 1, answers: [{ question: 42, answer: 'A1.' }] }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir }) as { ok: boolean };
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
    const turns = okTurns(deriveSessionTranscript({ descriptor: projectBrainDescriptor(), sessionDir }));
    assert.equal(turns.length, 1, `project-brain must be honestly one turn, got: ${JSON.stringify(turns)}`);
    assert.equal(turns[0].role, 'operator');
    assert.equal(turns[0].source, 'prompt.md');
    assert.equal(turns[0].stage, 'brain');
  });
});

// ===========================================================================
// deriveSessionArtifact — roadmap-draft (AT-29, AT-30)
// ===========================================================================

function realManifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-01-01-fixture-a',
    project: 'demoproj',
    project_repo_path: '/tmp/demoproj',
    created_at: '2026-01-01T00:00:00.000Z',
    iteration_budget: 10,
    cost_budget_usd: 5,
    phase: 'pending',
    origin: 'architect',
    body: '# Fixture initiative\n\nDo the thing.\n',
    ...overrides,
  } as InitiativeManifest;
}

describe('deriveSessionArtifact — roadmap-draft (real serializeManifest fixtures)', () => {
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

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir }) as {
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

  it('AT-30: zero manifests → an honest empty payload naming what was scanned, never a fabricated row', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-empty-');
    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir }) as {
      rows: unknown[];
      sourcesScanned: string[];
    };
    assert.deepEqual(artifact.rows, []);
    assert.ok(Array.isArray(artifact.sourcesScanned) && artifact.sourcesScanned.length > 0);
    assert.ok(artifact.sourcesScanned.some((s) => s.includes('manifests')));
  });
});

// ===========================================================================
// deriveSessionArtifact — markdown-draft (AT-31, AT-32)
// ===========================================================================

describe('deriveSessionArtifact — markdown-draft (byte-faithful AGENTS.draft.md)', () => {
  it('AT-31: returns the real AGENTS.draft.md body byte-for-byte, including trailing newline', () => {
    const sessionDir = makeTmpDir('artifact-md-');
    const body = '# AGENTS.md\n\nSome instructions.\n\n- a\n- b\n';
    writeFileSync(join(sessionDir, 'AGENTS.draft.md'), body, 'utf8');
    const artifact = deriveSessionArtifact({ descriptor: instructionsDescriptor(), sessionDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(artifact.body, body, 'body must be byte-identical, including the trailing newline');
    assert.equal(artifact.hasDraft, true);
  });

  it('AT-32: distinguishes "no draft yet" (missing file, body: null) from an "empty draft" (file exists, empty, body: "")', () => {
    const missingDir = makeTmpDir('artifact-md-missing-');
    const missing = deriveSessionArtifact({ descriptor: instructionsDescriptor(), sessionDir: missingDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(missing.body, null, 'no draft file at all must be null, never "" masquerading as content');
    assert.equal(missing.hasDraft, false);

    const emptyDir = makeTmpDir('artifact-md-empty-');
    writeFileSync(join(emptyDir, 'AGENTS.draft.md'), '', 'utf8');
    const empty = deriveSessionArtifact({ descriptor: instructionsDescriptor(), sessionDir: emptyDir }) as { body: string | null; hasDraft: boolean };
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

    const artifact = deriveSessionArtifact({ descriptor: projectBrainDescriptor(), sessionDir }) as {
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

describe('deriveSessionArtifact — a reserved artifact kind is never a stub', () => {
  it('AT-34: a descriptor whose artifact.kind is a RESERVED row (e.g. "file-package") → throws, naming the reserved kind', () => {
    const sessionDir = makeTmpDir('artifact-reserved-');
    const descriptor = architectDescriptor({ artifact: { kind: 'file-package' as SessionKindDescriptor['artifact']['kind'], label: 'Reserved' } });
    assert.throws(
      () => deriveSessionArtifact({ descriptor, sessionDir }),
      (err: unknown) => { assert.ok(err instanceof Error); assert.match(err.message, /file-package/); return true; },
    );
  });
});

// ===========================================================================
// Traversal / escape — REAL symlinks, realpath is the only thing that catches
// them (a lexical prefix check on the entry's OWN path always passes, since
// the symlink itself lives inside sessionDir) (AT-35, 36, 37)
// ===========================================================================

describe('escape via symlink — realpath required, lexical prefix checks are insufficient', () => {
  it('AT-35: deriveSessionTranscript — idea.md is a symlink pointing OUTSIDE sessionDir → the escaped secret content is never returned', () => {
    const outsideDir = makeTmpDir('transcript-escape-outside-');
    const secretPath = join(outsideDir, 'secret.txt');
    const SECRET_MARKER = 'TOP-SECRET-TRANSCRIPT-MARKER-8271';
    writeFileSync(secretPath, SECRET_MARKER, 'utf8');

    const sessionDir = makeTmpDir('transcript-escape-session-');
    // The symlink's OWN path is inside sessionDir — any check of the form
    // `path.startsWith(sessionDir)` on `idea.md`'s path trivially passes.
    // Only resolving via realpathSync(...) reveals the target escapes.
    symlinkSync(secretPath, join(sessionDir, 'idea.md'));

    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir });
    assert.ok(!JSON.stringify(result).includes(SECRET_MARKER), 'the escaped file\'s content must never appear in the derived transcript');
  });

  it('AT-36: deriveSessionArtifact (roadmap-draft) — a manifests/ entry is a symlink pointing OUTSIDE sessionDir → its content is never returned', () => {
    const outsideDir = makeTmpDir('artifact-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-MANIFEST-MARKER-5533';
    const secretManifestPath = join(outsideDir, 'secret-manifest.md');
    writeFileSync(secretManifestPath, serializeManifest(realManifest({ initiative_id: SECRET_MARKER })), 'utf8');

    const sessionDir = makeTmpDir('artifact-escape-session-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    symlinkSync(secretManifestPath, join(manifestsDir, 'evil.md'));

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir });
    assert.ok(!JSON.stringify(artifact).includes(SECRET_MARKER), 'the escaped manifest\'s content must never surface as a row');
  });

  it('AT-37: deriveSessionArtifact (brain-structure) — a themes/ entry is a symlink pointing OUTSIDE sessionDir → its content is never returned', () => {
    const outsideDir = makeTmpDir('brain-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-THEME-MARKER-9042';
    const secretThemePath = join(outsideDir, 'secret-theme.md');
    writeFileSync(secretThemePath, `# ${SECRET_MARKER}\n`, 'utf8');

    const sessionDir = makeTmpDir('brain-escape-session-');
    const themesDir = join(sessionDir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    symlinkSync(secretThemePath, join(themesDir, 'evil.md'));

    const artifact = deriveSessionArtifact({ descriptor: projectBrainDescriptor(), sessionDir });
    assert.ok(!JSON.stringify(artifact).includes(SECRET_MARKER), 'the escaped theme file\'s content must never surface in files[]');
  });
});
