import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runProjectBrainTurn,
  projectBrainSessionDir,
  projectBrainAgentSpec,
  PROJECT_BRAIN_MODEL,
  type ProjectBrainStatus,
} from '../../kinds/project-brain.ts';
import { writeSessionStatus, REDACTED_THINKING_MARKER, type QueryFn } from '../../interactive-session.ts';
// COMMON §15.43: the legacy `orchestrator/studio/registry.ts` only
// re-exports this — the real owner is `@forge/knowledge`, which sessions
// (rank 4) may import directly, so the move costs no boundary row.
import { loadKbDescriptor } from '@forge/knowledge/studio/kb-descriptor.ts';

function setup(
  phase: ProjectBrainStatus['phase'],
  overrides?: Partial<ProjectBrainStatus>,
): { forgeRoot: string; projectRoot: string; sessionDir: string; sessionId: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-'));
  const projectRoot = join(forgeRoot, 'projects', 'demoproj');
  const sessionId = '2026-06-27T10-00-00';
  const sessionDir = projectBrainSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'README.md'), '# demoproj\n');
  writeSessionStatus<ProjectBrainStatus>(sessionDir, {
    session_id: sessionId,
    project: 'demoproj',
    project_repo_path: projectRoot,
    phase,
    prompt: 'focus on the build + test conventions',
    updated_at: new Date().toISOString(),
    ...overrides,
  });
  return { forgeRoot, projectRoot, sessionDir, sessionId };
}

function makeQueryFn(effect?: () => void): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      effect?.();
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

test('analyzing → awaiting-review when the agent stages themes', async () => {
  const { forgeRoot, sessionDir, sessionId, projectRoot } = setup('analyzing');
  try {
    const staging = join(sessionDir, 'themes');
    const r = await runProjectBrainTurn({
      sessionId,
      projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      queryFn: makeQueryFn(() => {
        mkdirSync(staging, { recursive: true });
        writeFileSync(join(staging, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
        writeFileSync(join(staging, 'conventions.md'), '---\nname: conventions\n---\n# Conventions\n');
        writeFileSync(join(staging, 'profile.md'), '# demoproj profile\n');
      }),
    });
    assert.equal(r.phase, 'awaiting-review');
    assert.deepEqual(r.themes, ['conventions.md', 'profile.md', 'structure.md']);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam) — projectBrainAgentSpec
// stays strategy:fixed, so the only legal requested tier is the fixed one.
// ---------------------------------------------------------------------------

test('ADR-024: projectBrainAgentSpec derives tier (sonnet)', () => {
  assert.equal(projectBrainAgentSpec.tier, 'sonnet');
  assert.equal(PROJECT_BRAIN_MODEL, 'claude-sonnet-4-6');
});

test('status.modelTier equal to the fixed tier ("sonnet") is honored — reaches queryFn as options.model', async () => {
  const { forgeRoot, sessionId, projectRoot } = setup('analyzing', { modelTier: 'sonnet' });
  let capturedModel: string | undefined;
  try {
    const staging = projectBrainSessionDir(projectRoot, sessionId);
    await runProjectBrainTurn({
      sessionId,
      projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      queryFn: ({ options }) => {
        capturedModel = (options as { model?: string }).model;
        async function* gen(): AsyncGenerator<unknown> {
          const themesDir = join(staging, 'themes');
          mkdirSync(themesDir, { recursive: true });
          writeFileSync(join(themesDir, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
          yield { type: 'result', total_cost_usd: 0 };
        }
        return gen();
      },
    });
    assert.equal(capturedModel, 'claude-sonnet-4-6');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('status.modelTier absent resolves to the unchanged default (sonnet) — byte-identical prior behavior', async () => {
  const { forgeRoot, sessionId, projectRoot } = setup('analyzing');
  let capturedModel: string | undefined;
  try {
    const staging = projectBrainSessionDir(projectRoot, sessionId);
    await runProjectBrainTurn({
      sessionId,
      projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      queryFn: ({ options }) => {
        capturedModel = (options as { model?: string }).model;
        async function* gen(): AsyncGenerator<unknown> {
          const themesDir = join(staging, 'themes');
          mkdirSync(themesDir, { recursive: true });
          writeFileSync(join(themesDir, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
          yield { type: 'result', total_cost_usd: 0 };
        }
        return gen();
      },
    });
    assert.equal(capturedModel, PROJECT_BRAIN_MODEL);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('status.modelTier mismatching the fixed tier throws naming the value and the allowed set', async () => {
  const { forgeRoot, sessionId, projectRoot } = setup('analyzing', { modelTier: 'opus' });
  try {
    await assert.rejects(
      () => runProjectBrainTurn({
        sessionId, projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs'), queryFn: makeQueryFn(),
      }),
      /requested model tier "opus".*allowed tier\(s\): sonnet/,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('W6-B1: analyzing turn forwards thinking + coalesced redacted_thinking to the event log, and Read tool_use events are unsampled', async () => {
  const { forgeRoot, sessionDir, sessionId, projectRoot } = setup('analyzing');
  try {
    const staging = join(sessionDir, 'themes');
    const READ_CALLS = 6;
    const queryFn: QueryFn = () => {
      async function* gen(): AsyncGenerator<unknown> {
        const reads = Array.from({ length: READ_CALLS }, (_, i) => ({
          type: 'tool_use', name: 'Read', input: { file_path: `f${i}.md` },
        }));
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: '  weighing the theme structure  ' },
              { type: 'redacted_thinking', data: 'opaque-1' },
              { type: 'redacted_thinking', data: 'opaque-2' }, // consecutive — must coalesce
              ...reads,
            ],
          },
        };
        mkdirSync(staging, { recursive: true });
        writeFileSync(join(staging, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
        yield { type: 'result', total_cost_usd: 0 };
      }
      return gen();
    };

    await runProjectBrainTurn({ sessionId, projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs'), queryFn });

    const events = readFileSync(join(forgeRoot, '_logs', `_project-brain-${sessionId}`, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const thinkingEvents = events.filter((e) => e.metadata?.kind === 'thinking');
    assert.equal(thinkingEvents.length, 2, 'one real thinking row + ONE coalesced row for the two consecutive redacted markers');
    assert.equal(thinkingEvents[0].message, 'weighing the theme structure');
    assert.equal(thinkingEvents[1].message, REDACTED_THINKING_MARKER);

    const readToolUses = events.filter((e) => e.event_type === 'tool_use' && e.metadata?.tool === 'Read');
    assert.equal(readToolUses.length, READ_CALLS, 'sampler opts {readOnlySampleRate:1, cap:200} — every Read emitted, none sampled out');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('analyzing with no staged themes → throws (retry)', async () => {
  const { forgeRoot, sessionId, projectRoot } = setup('analyzing');
  try {
    await assert.rejects(
      () => runProjectBrainTurn({ sessionId, projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs'), queryFn: makeQueryFn() }),
      /produced no theme files/,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('committing copies staged themes into the central project brain + kb.yaml', async () => {
  const { forgeRoot, sessionDir, sessionId, projectRoot } = setup('committing');
  try {
    const staging = join(sessionDir, 'themes');
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
    writeFileSync(join(staging, 'profile.md'), '# demoproj profile\n');

    const r = await runProjectBrainTurn({ sessionId, projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs') });
    assert.equal(r.phase, 'committed');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'themes', 'structure.md')), 'theme committed to central brain');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'profile.md')), 'profile committed');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'kb.yaml')), 'kb.yaml scaffolded');
    const committedKb = loadKbDescriptor(join(forgeRoot, 'brain', 'projects', 'demoproj', 'kb.yaml'));
    assert.deepEqual(committedKb.binding, { kind: 'project', ref: 'demoproj' }, 'kb.yaml carries the project binding');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R1-06 WI-2 group B (2): the runner's commit step must honor a
// DESCRIPTOR-DERIVED binding (T1 ruling Q4 option (a)) instead of always
// hardcoding `binding: { kind: 'project', ref: status.project }`
// (the kind module's guarded status write) and always writing under
// `brain/projects/<status.project>/` (~246). When the session was started as
// the R1-06-F2 hand-off for a KB created via POST /api/studio/kbs (arbitrary
// id, arbitrary binding — e.g. a flow/band-scoped KB), the commit must write
// to that KB's OWN brain dir (`brain/<kbId>/`, matching the scaffold POST
// /api/studio/kbs already created) with THAT binding — never silently
// re-derive `{ kind: 'project', ref: status.project }`.
//
// The `_project-brain/<sid>` session-dir derivation itself is left
// untouched (T1 ruling) — only status.json carries the extra
// descriptor-derived fields (`kb_id` / `kb_binding`) a KB-scoped hand-off
// session needs. Written directly (not via the typed `writeSessionStatus`
// helper) because `ProjectBrainStatus` does not declare these fields yet —
// that absence is exactly what this pin is red on.
// ---------------------------------------------------------------------------

test('RED (R1-06 WI-2 group B): committing a KB-scoped hand-off session honors its descriptor-derived binding, not a hardcoded {kind:"project"}', async () => {
  const { forgeRoot, sessionDir, sessionId, projectRoot } = setup('committing');
  try {
    const staging = join(sessionDir, 'themes');
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'profile.md'), '# review-insights profile\n');

    // Overwrite status.json with the descriptor-derived fields a KB-scoped
    // hand-off session carries: the KB's own id (distinct from the
    // "demoproj" project this session dir happens to be nested under) and
    // its real binding — a flow/band scope, the shape the ⚑ read-policy
    // gate (WI-1) already exists to cover.
    writeFileSync(
      join(sessionDir, 'status.json'),
      JSON.stringify({
        session_id: sessionId,
        project: 'demoproj',
        project_repo_path: projectRoot,
        phase: 'committing',
        prompt: '',
        updated_at: new Date().toISOString(),
        kb_id: 'review-insights',
        kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
      }),
    );

    const r = await runProjectBrainTurn({ sessionId, projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs') });
    assert.equal(r.phase, 'committed');

    const kbYamlPath = join(forgeRoot, 'brain', 'review-insights', 'kb.yaml');
    assert.ok(
      existsSync(kbYamlPath),
      `kb.yaml must be written at the descriptor-derived location brain/review-insights/kb.yaml — today the runner ignores kb_id/kb_binding and always writes brain/projects/demoproj/kb.yaml instead (exists: ${existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'kb.yaml'))})`,
    );
    const committedKb = loadKbDescriptor(kbYamlPath);
    assert.deepEqual(
      committedKb.binding,
      { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
      'kb.yaml must carry the descriptor-derived flow/band binding, not a hardcoded {kind:"project", ref: status.project}',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W7-C3 review (A-M9) — the third session kind. `instructions` and `demo`
// stopped billing `architect`/`unifier` in this PR; project-brain still filed
// every event under `reflection`, the OOTB reflector's cycle-spine phase, and
// its test had no `e.phase` assertion at all — so "session kinds log their own
// phase" was 2 of 3.
// ---------------------------------------------------------------------------

test("W7-C3 review (A-M9): every event row carries phase 'project-brain' — never 'reflection'", async () => {
  const { forgeRoot, sessionId, projectRoot, sessionDir } = setup('analyzing');
  try {
    const logsRoot = join(forgeRoot, '_logs');
    await runProjectBrainTurn({
      sessionId,
      projectRoot,
      forgeRoot,
      logsRoot,
      queryFn: makeQueryFn(() => {
        mkdirSync(join(sessionDir, 'themes'), { recursive: true });
        writeFileSync(join(sessionDir, 'themes', 'structure.md'), '---\nname: structure\n---\n# Structure\n');
      }),
    });

    const events = readFileSync(join(logsRoot, `_project-brain-${sessionId}`, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(events.length > 0, 'the turn emitted events');
    for (const e of events) {
      assert.equal(
        e.phase, 'project-brain',
        `event ${e.event_type} "${e.message}" filed under phase "${e.phase}" — a project-brain session must not bill the reflector's cycle-spine phase`,
      );
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('ADR-024 (A-M10): the SKILL.md frontmatter phase and the emitted phase agree', () => {
  // Under ADR-024 the frontmatter is the single source of intent; the runner
  // emitting something else made the two contradict each other silently (no
  // live consumer reads PhaseAgentSpec.phase, so nothing failed).
  assert.equal(projectBrainAgentSpec.phase, 'project-brain');
  assert.equal(PROJECT_BRAIN_MODEL.length > 0, true);
});
