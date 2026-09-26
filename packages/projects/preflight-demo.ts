/**
 * forge↔project contract preflight — the DEMO clause family (US-4.1 /
 * ADR-017). DEMO (demoProcess declared), DEMO-SKILL (the demo declaration
 * drives at least one checkpoint, bead forge-mfv5.2.2), DEMO-ALIGN (demo
 * builds off the declared test process). All advisory. A clause-family leaf
 * of `preflight.ts`, whose header carries the split's reasoning and the
 * sibling map.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { extractDrivableCommand } from '@forge/contracts';

import { loadProjectConfig, type ProjectConfig } from './project-config.ts';
import type { ClauseResult } from '@forge/kernel';

// --- DEMO: the project declares how its change is demonstrated (ADVISORY) ---

/**
 * Delegates validation to `loadProjectConfig` from packages/projects/project-config.ts
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

// --- DEMO-SKILL: the demo declaration drives at least one checkpoint (ADVISORY) ---

/**
 * bead forge-mfv5.2.2: `demoProcess` is the SOLE cycle-time demo input — the
 * integrate band derives checkpoints from it (and from the initiative's typed
 * acceptance criteria), never from any generated file. This clause used to
 * check `existsSync` of a generated `.forge/skills/demo-design/SKILL.md`; that
 * file is presentation guidance for the Studio demo page (authored by the
 * demo-builder session) and is read by nothing at cycle time, so its presence
 * proved nothing about whether the declaration could actually drive a demo.
 *
 * The clause now applies `extractDrivableCommand` (`@forge/contracts`) — the
 * SAME rule `derive-demo-model.ts`'s `captureCheckpoints` applies at cycle
 * time — to every `kind: 'capture'` step, and passes iff at least one yields a
 * bare-argv command. `checkDemo` only validates the demoProcess SHAPE (≥1
 * capture + ≥1 verify); this verifies at least one capture step is actually
 * actionable. Advisory: not applicable until a demoProcess is declared at all
 * (`checkDemo` owns that case — no double-warn).
 */
function checkDemoSkill(dir: string): ClauseResult {
  const base = {
    clause: 'DEMO-SKILL' as const,
    title: 'The demo declaration drives at least one checkpoint',
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
    // No demoProcess yet at all → not applicable; checkDemo already warns.
    return { ...base, pass: true, detail: 'no demoProcess declared yet — not applicable' };
  }
  const captureSteps = steps
    .map((step, i) => ({ step, i }))
    .filter(({ step }) => step.kind === 'capture');
  const drivable = captureSteps.filter(({ step }) => extractDrivableCommand(step.text).ok);
  if (drivable.length > 0) {
    return {
      ...base,
      pass: true,
      detail: `${drivable.length} of ${captureSteps.length} capture step(s) drive a checkpoint`,
    };
  }
  if (captureSteps.length === 0) {
    return {
      ...base,
      pass: false,
      detail: "demoProcess declares no step of kind 'capture' — nothing can drive a checkpoint. Advisory.",
    };
  }
  const reasons = captureSteps.map(({ step, i }) => {
    const result = extractDrivableCommand(step.text);
    const why = result.ok
      ? '' // unreachable: drivable.length === 0 means every entry is !ok
      : result.reason === 'no-inline-code'
        ? 'no inline-code span to run'
        : `shell metacharacters in \`${result.code}\``;
    return `capture step ${i} ("${step.text.slice(0, 60)}") yields no drivable command — ${why}`;
  });
  return { ...base, pass: false, detail: `${reasons.join('; ')}. Advisory.` };
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
