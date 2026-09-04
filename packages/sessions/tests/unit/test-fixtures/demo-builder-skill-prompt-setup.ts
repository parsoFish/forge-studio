/**
 * The skill-prompt suite's OWN scaffolding. Deliberately NOT shared with
 * `demo-builder-runner.test.ts`'s `setup()`.
 *
 * The M4-sessions s5 outcome recorded these two as "the same helper twice,
 * differing only by an optional `demoProcess` parameter and the mkdtemp
 * prefix", and recommended collapsing them under ruling 91. Read side by side
 * they differ in FIVE ways, and every one is asserted on by exactly one side:
 * the mkdtemp prefix, the sessionId (`2026-08-14T00-00-00` here vs
 * `2026-06-24T11-00-00` there), the project name (`skillprompt-demo` vs
 * `demo`), the seeded `demoProcess`, and the prompt — which here is
 * `OPERATOR_GUIDANCE_SENTINEL`, referenced four times by this suite and never
 * by the runner's.
 *
 * Collapsing them yields a helper with five parameters whose two call sites
 * pass disjoint sets. That is not a shared fixture, it is a switch with two
 * users, and it couples two suites through a fixture — the same objection the
 * s5 outcome itself raised to sharing the two `makeWritingQueryFn`s, which
 * does hold and which this PR honours.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { demoSessionDir, DEMO_SKILL_REL_PATH, DEMO_HTML_REL_PATH, type DemoBuilderStatus } from '../../../kinds/demo-builder.ts';
import { type QueryFn } from '../../../interactive-session.ts';
import { writeSessionStatus } from '../../../interactive-session.ts';
import { createLogger } from '@forge/kernel';
import type { DemoStep } from '@forge/contracts/studio/types.ts';

/**
 * Lane R4-23 WI-2 — acceptance tests for re-authoring the demo-builder
 * generate-step prompt onto `skills/demo-builder/SKILL.md` turn sections
 * (see the authoritative design at `_wave5/.../R4-23-design.md`: the
 * `<!-- turn: <id> -->` SKILL.md convention + the `loadSkillTurnPrompt` /
 * `splitSkillTurnSections` loader contract landing in `packages/agents/skill-path.ts`
 * via WI-1). WI-2 moves the generate-step's INSTRUCTION PROSE (the three
 * branch bodies — per-element / composed / legacy — plus the update-mode
 * guidance) out of the demo-builder runner (now `kinds/demo-builder.ts`) and into the skill.
 * The runner keeps injecting only DATA: project name/repo path, operator
 * guidance/feedback, the ordered element-step list, the element generator
 * bodies, and the forge base stylesheet.
 *
 * These are the ATs WI-2 must satisfy. THEY ARE IMMUTABLE — an implementer
 * may not weaken an assertion to make it pass; a legitimate rename (e.g. of
 * the turn ids) must still make every AT below pass as written, because the
 * fixtures pin the turn-id convention this design document plans
 * (`generate-element` / `generate-composed` / `generate-legacy`) as part of
 * the accepted contract (see "design ambiguity resolved" note in the PR /
 * session report this file shipped with).
 *
 * Each AT and what it kills:
 *   AT-1 prose-left-the-TS   — an implementer who copy-pastes the prose into
 *                              SKILL.md but forgets to DELETE it from the .ts
 *                              (intent still lives in two places).
 *   AT-2 no fail-open remains — an implementer who keeps the old
 *                              `You are the forge demo-builder agent.`
 *                              fallback or the runner-private `loadSkillPrompt`
 *                              (the declared-data-fails-open antipattern).
 *   AT-3 loaded-AND-USED +
 *        selection            — an implementer who concatenates ALL turn
 *                              sections into every prompt instead of
 *                              selecting the one matching the branch.
 *   AT-4 fail-loud            — an implementer who silently falls back to
 *                              SOME default prompt when the fixture skill has
 *                              no turn markers, instead of throwing.
 *   AT-5 data-half preserved  — an implementer who moves data (not just
 *                              prose) into SKILL.md, breaking per-run
 *                              injection of project/repo/guidance/feedback.
 *   AT-6 demoTaskLines
 *        contract survives    — an implementer who removes/renames
 *                              `demoTaskLines` or breaks its ordering
 *                              contract, silently breaking the R4-07
 *                              descriptor-parity test
 *                              (`packages/projects/tests/contract/demo-descriptor-parity.test.ts`).
 *
 * Harness idiom mirrors `packages/sessions/demo-builder-runner.test.ts`: seed
 * `projectRoot/_demo/<sid>/status.json` via `writeSessionStatus`, inject a
 * stub `queryFn` that simulates the agent's file writes, and (new to this
 * file) inject `skillPromptPath` fixtures to drive/observe turn selection.
 */



// Anchored on the kernel's FORGE_ROOT, not a hand-counted `..` chain
// (COMMON §15.14): a depth-coupled chain silently re-points at a file that
// does not exist the moment either end moves.
export const RUNNER_TS_PATH = join(FORGE_ROOT, 'packages', 'sessions', 'kinds', 'demo-builder.ts');
export const SKILL_MD_PATH = join(FORGE_ROOT, 'skills', 'demo-builder', 'SKILL.md');

/** Normalise whitespace on both sides before comparing — the moved sentences
 *  are built today by multi-line array-join concatenation in the .ts, so a
 *  byte-for-byte substring check would be brittle to reformatting either side. */
export function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Shared scaffolding — mirrors packages/sessions/demo-builder-runner.test.ts's setup().
// ---------------------------------------------------------------------------

export const OPERATOR_GUIDANCE_SENTINEL = 'OPERATOR-GUIDANCE-SENTINEL-4471: keep it dark and minimal.';

export function setup(overrides?: Partial<DemoBuilderStatus>, demoProcess?: DemoStep[]): {
  projectRoot: string;
  repoPath: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'demo-skillprompt-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(join(repoPath, '.forge'), { recursive: true });
  writeFileSync(
    join(repoPath, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: { local: { cmd: ['npm', 'test'] } },
      demoProcess: demoProcess ?? [
        { kind: 'capture', text: 'Run the CLI on a sample.' },
        { kind: 'verify', text: 'Output matches the golden file.' },
      ],
    }),
  );
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-14T00-00-00';
  const sessionDir = demoSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: sessionId,
    project: 'skillprompt-demo',
    project_repo_path: repoPath,
    phase: 'generating',
    iteration: 1,
    prompt: OPERATOR_GUIDANCE_SENTINEL,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, logsRoot, sessionId, sessionDir };
}

export const loggerFor = (logsRoot: string, sid: string) => createLogger(`_demo-${sid}`, logsRoot);

/** Simulates the agent writing the composer skill + sample DEMO.html
 *  (legacy / composed branches). */
export function makeWritingQueryFn(capture?: (prompt: string) => void): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
      writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design (fixture)');
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0.02 };
    }
    return gen();
  };
}

/** Simulates the agent writing ONLY a per-element project-side skill + the
 *  sample (targetElement branch). */
export function makeElementWritingQueryFn(elementId: string, capture?: (prompt: string) => void): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo', elementId), { recursive: true });
      writeFileSync(join(cwd, '.forge', 'skills', 'demo', elementId, 'SKILL.md'), `# ${elementId} element (fixture)`);
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>element fragment</body></html>');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
}

