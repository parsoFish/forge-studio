/**
 * `forge instructions` and `forge constraints` — the project-instruction verbs,
 * split out of cli.ts so each verb sits in a small module (cli-gate.ts,
 * cli-create.ts, cli-cost.ts follow the same shape). The project directory is
 * resolved by the caller's own resolver, so `forge preflight` and these verbs
 * cannot disagree about where a project lives.
 */
import { resolve } from 'node:path';
import { composeAgentsMd } from '@forge/agents';
import { authorConstraintBlocks } from '@forge/projects';
import { cmdAgentRun } from './agent-run.ts';
import { AGENT_DISPATCH_DEPS } from './session-kind-deps.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

/** Resolves a project name or path to its directory, exiting on a miss. */
export type ResolveProjectDir = (target: string | undefined) => string;

export async function cmdInstructions(rest: string[], resolveProjectDir: ResolveProjectDir): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdInstructionsRun(rest.slice(1));
  if (sub === 'compose') return cmdInstructionsCompose(rest.slice(1), resolveProjectDir);
  console.error('forge instructions: subcommands: run <session-id> --project <name> | compose --project <name>');
  console.error('  forge instructions run <session-id> --project <name>');
  console.error('  forge instructions compose --project <name>   (R4-02-F4: unattended AGENTS.md from seeds)');
  process.exit(2);
}

/** `forge instructions compose --project <name>` (R4-02-F4) — deterministically
 *  author AGENTS.md from the matched instruction seeds + the declared gate. */
function cmdInstructionsCompose(rest: string[], resolveProjectDir: ResolveProjectDir): void {
  const i = rest.indexOf('--project');
  const project = i >= 0 ? rest[i + 1] : rest.find((a) => !a.startsWith('--'));
  if (!project) { console.error('forge instructions compose: requires --project <name>'); process.exit(2); return; }
  const projectDir = resolveProjectDir(project);
  const out = composeAgentsMd({ projectDir, forgeRoot: FORGE_ROOT });
  const gateNote = out.gateCmd
    ? ` — gate "${out.gateCmd}" covered: ${out.gateCovered}`
    : ' — no gate declared yet (declare it first for C8 coverage)';
  console.log(
    out.wrote
      ? `instructions compose: wrote ${out.path} — ${out.seedIds.length} seed(s): ${out.seedIds.join(', ') || '(none)'}${gateNote}`
      : `instructions compose: ${out.path} already exists — left untouched${gateNote}${out.gateCmd && !out.gateCovered ? ' (edit it by hand to name the gate)' : ''}`,
  );
  // A declared-but-uncovered gate is a real C8 miss the caller must address.
  if (out.gateCmd && !out.gateCovered) process.exit(1);
}

/** `forge constraints author --project <name>` (R4-02-F5) — author the project's
 *  locked-core constraints as live forge:constraint blocks in central profile.md. */
export function cmdConstraints(rest: string[], resolveProjectDir: ResolveProjectDir): void {
  const sub = rest[0];
  if (sub !== 'author') {
    console.error('forge constraints: subcommands: author --project <name>');
    process.exit(2);
    return;
  }
  const flags = rest.slice(1);
  const i = flags.indexOf('--project');
  const project = i >= 0 ? flags[i + 1] : flags.find((a) => !a.startsWith('--'));
  if (!project) { console.error('forge constraints author: requires --project <name>'); process.exit(2); return; }
  try {
    const out = authorConstraintBlocks({ projectDir: resolveProjectDir(project), forgeRoot: FORGE_ROOT, project });
    console.log(
      out.authored.length > 0
        ? `constraints author: wrote ${out.authored.length} block(s) [${out.authored.join(', ')}] from ${out.source} → ${out.profilePath}`
        : `constraints author: no constraints source (CONSTRAINTS.md / Locked-core section) — profile left untagged (compiles under the ADR-037 default)`,
    );
  } catch (err) {
    console.error(`forge constraints author: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// R2-01-F3a: delegates into the shared cmdAgentRun skeleton (see the registry
// above) — behavior (error text, exit codes, printed summary) is unchanged.
async function cmdInstructionsRun(rest: string[]): Promise<void> {
  return cmdAgentRun(['instructions', ...rest], FORGE_ROOT, AGENT_DISPATCH_DEPS);
}
