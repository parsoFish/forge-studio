/**
 * forge↔project contract preflight — the DEMO clause family (US-4.1 /
 * ADR-017). DEMO (demoProcess declared), DEMO-SKILL (the generated
 * demo-design machinery exists, DEC-4), DEMO-ALIGN (demo builds off the
 * declared test process). All advisory. Split out of `preflight.ts` (the
 * barrel) when that file grew past the 800-line baseline cap; see
 * `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`.
 * Siblings: `preflight-gate.ts` (C1/C1b/C7), `preflight-instructions.ts`
 * (C5/C8), `preflight-release.ts` (C10), `preflight-build.ts`
 * (BUILD/ARTIFACTS), `preflight-repo.ts` (C2/C6).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadProjectConfig, type ProjectConfig } from './project-config.ts';
import type { ClauseResult } from '@forge/kernel';

// --- DEMO: the project declares how its change is demonstrated (ADVISORY) ---

/**
 * Delegates validation to `loadProjectConfig` from orchestrator/project-config.ts
 * (single source of truth; also single-sources the quality_gate_cmd sidecar). On
 * a structural violation the throw is caught and downgraded to an advisory WARN —
 * DEMO is never a hard blocker.
 */
// Exported for the R4-07 descriptor-parity test (one fixture, three consumers:
// preflight DEMO clause, demo-builder composition, demo-agent briefing).
export function checkDemo(dir: string): ClauseResult {
  const base = { clause: 'DEMO' as const, title: 'Demo process declared (.forge/project.json demoProcess)', hard: false };
  const cfgPath = join(dir, '.forge', 'project.json');
  if (!existsSync(cfgPath)) {
    return { ...base, pass: false, detail: 'no .forge/project.json — demoProcess undeclared. Advisory.' };
  }
  let cfg: NonNullable<ReturnType<typeof loadProjectConfig>>;
  try {
    const loaded = loadProjectConfig(dir);
    if (!loaded) return { ...base, pass: false, detail: '.forge/project.json is not readable. Advisory.' };
    cfg = loaded;
  } catch (err) {
    return { ...base, pass: false, detail: `.forge/project.json failed validation: ${err instanceof Error ? err.message : String(err)}. Advisory.` };
  }
  const steps = cfg.demoProcess ?? [];
  const hasCapture = steps.some((s) => s.kind === 'capture');
  const hasVerify = steps.some((s) => s.kind === 'verify');
  if (!hasCapture || !hasVerify) {
    return { ...base, pass: false, detail: `demoProcess needs ≥1 capture step and ≥1 verify step (found ${steps.length} step(s)). Run the demo-design skill to generate demo machinery. Advisory.` };
  }
  return { ...base, pass: true, detail: `demoProcess has ${steps.length} step(s) including capture + verify` };
}

// --- DEMO-SKILL: the GENERATED demo-design machinery exists (ADVISORY, DEC-4) ---

/** The fixed path DEC-4 names for a project's generated demo-design skill, so a
 *  scorecard can verify it deterministically. */
const DEMO_SKILL_REL = join('.forge', 'skills', 'demo-design', 'SKILL.md');

/**
 * DEC-4: every project that declares a demoProcess should also carry a GENERATED
 * `.forge/skills/demo-design/SKILL.md` (the per-project demo machinery the unifier
 * follows). checkDemo only validates the demoProcess SHAPE; this verifies the
 * skill was actually generated. Advisory: not applicable until a demoProcess is
 * declared (checkDemo owns that case — no double-warn).
 */
function checkDemoSkill(dir: string): ClauseResult {
  const base = {
    clause: 'DEMO-SKILL' as const,
    title: `Generated demo-design skill present (${DEMO_SKILL_REL})`,
    hard: false,
  };
  let cfg: ReturnType<typeof loadProjectConfig> | null = null;
  try {
    cfg = loadProjectConfig(dir);
  } catch {
    cfg = null;
  }
  const steps = cfg?.demoProcess ?? [];
  if (steps.length === 0) {
    // No demoProcess yet → the demo-design generator is not applicable; checkDemo
    // already warns about the missing demoProcess.
    return { ...base, pass: true, detail: 'no demoProcess declared yet — demo-design generator not applicable' };
  }
  if (!existsSync(join(dir, DEMO_SKILL_REL))) {
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
    return {
      ...base,
      pass: false,
      detail: `project "${name}" declares a demoProcess but has no ${DEMO_SKILL_REL} — run the demo-design generator (\`forge run skill demo-design --project ${name}\`) to generate the per-project demo machinery. Advisory.`,
    };
  }
  return { ...base, pass: true, detail: `${DEMO_SKILL_REL} present (generated demo machinery)` };
}

// --- DEMO-ALIGN: demo-builds-off-testing alignment (ADVISORY, R1-03-F3) ---

/**
 * The operator diagram's "alignment recommended — demo should largely build
 * off testing": each demoProcess CAPTURE step SHOULD reference the declared
 * test process. Heuristic (cheap + honest): a capture step is aligned when
 * its element kind IS test output (`test-evidence`), or its text mentions a
 * test-process reference token — a full joined local/ci command string, a
 * distinctive argv token, or the acceptance `match` substring. ALWAYS
 * advisory: divergence may be intentional (live REST evidence per the
 * betterado tier) — flagged, never blocked, and never part of hard readiness.
 */
const DEMO_ALIGN_TOKEN_STOPLIST = new Set(['bash', 'npm', 'node', 'make', 'test', 'run', 'npx', 'go']);

function demoAlignmentTokens(cfg: ProjectConfig): string[] {
  const tokens = new Set<string>();
  const cmds = [cfg.testProcess.local.cmd, cfg.testProcess.ci?.cmd ?? []];
  for (const cmd of cmds) {
    if (cmd.length === 0) continue;
    tokens.add(cmd.join(' ').toLowerCase());
    for (const t of cmd) {
      const lowered = t.toLowerCase();
      if (lowered.length >= 4 && !DEMO_ALIGN_TOKEN_STOPLIST.has(lowered) && !lowered.startsWith('-')) {
        tokens.add(lowered);
      }
    }
  }
  if (cfg.testProcess.acceptance) tokens.add(cfg.testProcess.acceptance.match.toLowerCase());
  return [...tokens];
}

function checkDemoAlignment(cfg: ProjectConfig | null): ClauseResult {
  const base = {
    clause: 'DEMO-ALIGN' as const,
    title: 'Demo builds off the test process (alignment recommended)',
    hard: false,
  };
  const steps = cfg?.demoProcess ?? [];
  const captures = steps.filter((s) => s.kind === 'capture');
  if (!cfg || captures.length === 0) {
    return { ...base, pass: true, detail: 'no capture steps declared — alignment not applicable' };
  }
  const tokens = demoAlignmentTokens(cfg);
  const divergent = captures.filter((s) => {
    if (s.element === 'test-evidence') return false;
    const text = s.text.toLowerCase();
    return !tokens.some((t) => text.includes(t));
  });
  if (divergent.length === 0) {
    return {
      ...base,
      pass: true,
      detail: `all ${captures.length} capture step(s) reference the declared test process`,
    };
  }
  const detail = divergent
    .map((s) => `capture "${s.text.slice(0, 60)}" does not reference the declared test process`)
    .join('; ');
  return {
    ...base,
    pass: false,
    detail: `${detail} — advisory: divergence may be intentional (live evidence); demo should largely build off testing`,
  };
}

export { checkDemoSkill, checkDemoAlignment };
