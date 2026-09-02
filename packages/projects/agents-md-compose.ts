/**
 * composeAgentsMd (R4-02-F4) — deterministic, unattended AGENTS.md authoring
 * from the R3-05 instruction-seed library, for the onboarding agent.
 *
 * The interactive instructions-creator (`instructions-runner.ts`) composes
 * AGENTS.md through an operator-confirmed LLM turn. The onboarding agent runs
 * unattended, so this is the deterministic counterpart: match the seed library
 * to the project's detected shape, concatenate the matched seed bodies, and —
 * critically for the R1-04-F1 C8 coverage clause — name the declared quality
 * gate command at the top. No LLM, fully testable.
 *
 * Ordering (the F4 constraint): the gate command must already be declared in
 * `.forge/project.json` before this runs, else the composed AGENTS.md can't
 * name it and C8 only ever passes on presence, not coverage. The onboarding
 * SKILL.md sequences "declare the gate" before "compose AGENTS.md".
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  detectProjectTags,
  matchInstructionSeeds,
  composedSeedsFooter,
  stripComposedSeedsFooter,
} from '@forge/library/instruction-seed-match.ts';
import { listInstructionSeeds } from '@forge/library/studio/artifact-registry.ts';
import { loadProjectConfig } from './project-config.ts';
import type { InstructionSeed } from '@forge/contracts/studio/types.ts';

export type ComposeAgentsMdResult = {
  /** Absolute path to the AGENTS.md/CLAUDE.md considered. */
  path: string;
  /** Ids of the seeds composed from ([] when an existing file was left in place). */
  seedIds: string[];
  /** The declared gate command, or '' if none is declared yet. */
  gateCmd: string;
  /** True iff the file names the declared gate command (the C8 coverage bar). */
  gateCovered: boolean;
  /** False when an operator instruction file already existed and was NOT clobbered. */
  wrote: boolean;
};

/** The declared per-iteration quality gate, joined to a single command string. */
function declaredGateCmd(projectDir: string): string {
  const cfg = loadProjectConfig(projectDir);
  return cfg?.testProcess.local.cmd.join(' ') ?? '';
}

export function buildAgentsMdBody(projectName: string, gateCmd: string, matched: readonly InstructionSeed[]): string {
  const lines = [`# ${projectName} — agent instructions`, ''];
  if (gateCmd) {
    lines.push(
      '## Quality gate',
      '',
      `Run \`${gateCmd}\` every iteration — the change is not done until it passes. It must fail before the work exists and pass only when the behaviour is correct.`,
      '',
    );
  }
  if (matched.length > 0) {
    lines.push('## Conventions (composed from vetted instruction seeds)', '');
    for (const s of matched) {
      lines.push(s.body.trim(), '');
    }
  }
  // strip any pre-existing footer defensively, then append the traceability footer.
  return stripComposedSeedsFooter(lines.join('\n').trimEnd()) + composedSeedsFooter(matched.map((s) => s.id));
}

/**
 * Compose (overwrite) `<projectDir>/AGENTS.md` from the matched instruction
 * seeds + the declared gate command. Idempotent — deterministic output for a
 * given project shape + gate.
 */
export function composeAgentsMd(input: {
  projectDir: string;
  forgeRoot: string;
  /** Overwrite an existing instruction file (default false — never clobber). */
  overwrite?: boolean;
}): ComposeAgentsMdResult {
  const { projectDir, forgeRoot } = input;
  const gateCmd = declaredGateCmd(projectDir);

  // Never clobber an operator's hand-authored AGENTS.md/CLAUDE.md. Report its
  // gate coverage instead; the onboarding agent edits it by hand if it's thin.
  const agentsPath = join(projectDir, 'AGENTS.md');
  const claudePath = join(projectDir, 'CLAUDE.md');
  const existingPath = existsSync(agentsPath) ? agentsPath : existsSync(claudePath) ? claudePath : null;
  if (existingPath && input.overwrite !== true) {
    const existing = readFileSync(existingPath, 'utf8');
    return {
      path: existingPath,
      seedIds: [],
      gateCmd,
      gateCovered: gateCmd !== '' && existing.includes(gateCmd),
      wrote: false,
    };
  }

  const tags = detectProjectTags(projectDir);
  const matched = matchInstructionSeeds(listInstructionSeeds(forgeRoot), tags);
  const projectName = basename(projectDir.replace(/[\\/]+$/, ''));
  const body = buildAgentsMdBody(projectName, gateCmd, matched);
  writeFileSync(agentsPath, body.endsWith('\n') ? body : body + '\n', 'utf8');
  // Coverage: a verbatim whole-command mention always satisfies C8's
  // mentionsCommand (which also accepts a runner+subcommand needle).
  const gateCovered = gateCmd !== '' && body.includes(gateCmd);
  return { path: agentsPath, seedIds: matched.map((s) => s.id), gateCmd, gateCovered, wrote: true };
}
