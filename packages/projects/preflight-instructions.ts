/**
 * forge↔project contract preflight — the "instructions" clause family
 * (US-4.1 / ADR-017). C5 (locked-core constraints declared, advisory) and C8
 * (agent-instruction file present + covers the declared gate, advisory).
 * Split out of `preflight.ts` (the barrel) when that file grew past the
 * 800-line baseline cap; see `scripts/baselines/file-size.json` /
 * `scripts/check-file-size.mjs`. Siblings: `preflight-gate.ts` (C1/C1b/C7,
 * source of the shared `readQualityGateCmd`), `preflight-demo.ts`,
 * `preflight-release.ts`, `preflight-build.ts`, `preflight-repo.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectConfig } from './project-config.ts';
import type { ClauseResult } from '@forge/kernel';
import { readQualityGateCmd } from './preflight-gate.ts';

// C8: the project must have a human-authored agent-instruction file at its
// root. Research shows ~4pp uplift from human-authored AGENTS.md/CLAUDE.md;
// auto-generated files hurt. Advisory: absence is a gap, not a hard block.
const AGENT_INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const;

// --- C5: locked-core mandates the harness honours (ADVISORY) ---

function checkC5(dir: string): ClauseResult {
  const base = { clause: 'C5' as const, title: 'Locked-core constraints declared', hard: false };
  const candidates = ['CLAUDE.md', 'AGENTS.md', '.forge/constraints.md', 'CONSTRAINTS.md'];
  const found = candidates.find((c) => existsSync(join(dir, c)));
  if (found) {
    return {
      ...base,
      pass: true,
      detail: `${found} present (operator declared constraints; forge honours git-ownership / no-test-tampering per the doc)`,
    };
  }
  return {
    ...base,
    pass: false,
    detail:
      `no constraints doc (${candidates.join(' / ')}). Advisory: forge cannot honour locked-core ` +
      'mandates it was never told about — strongly recommend a CLAUDE.md.',
  };
}

// --- C8: agent-instruction file (ADVISORY) ---

/**
 * Advisory: the project must expose a human-authored AGENTS.md or CLAUDE.md
 * at its root. Research shows ~4pp uplift from human-authored agent-instruction
 * files; auto-generated files hurt. This clause requires *presence*, never
 * auto-generation. Advisory (never blocks).
 *
 * R1-04-F1 — beyond presence, a COVERAGE check: an instruction file that never
 * mentions the project's declared quality-gate command is stale/thin (the agent
 * won't learn the gate it must pass every iteration from a file that omits it).
 * Machine-greppable: the file text must contain the declared gate command. A
 * miss routes to the instructions-creator (edit mode) via `preflight-resolve`'s
 * C8→instructions mapping — the file stays operator-owned (no auto-generation).
 * Skipped when no gate is declared yet (pre-onboarding) — presence-only then.
 */
function checkC8(dir: string, cfg: ProjectConfig | null): ClauseResult {
  const base = { clause: 'C8' as const, title: 'Agent-instruction file (AGENTS.md or CLAUDE.md)', hard: false };
  const found = AGENT_INSTRUCTION_CANDIDATES.find((f) => existsSync(join(dir, f)));
  if (!found) {
    return {
      ...base,
      pass: false,
      detail:
        `no AGENTS.md or CLAUDE.md at project root. Advisory: human-authored agent-instruction files ` +
        `give ~4pp task-completion uplift; auto-generated ones hurt. Create one with build/test/lint ` +
        `commands at the top and any locked-core mandates (e.g. "never edit tests to pass").`,
    };
  }
  // Coverage (R1-04-F1): does the present file mention the declared gate command?
  const gate = readQualityGateCmd(dir, cfg);
  if (gate) {
    let content = '';
    try {
      content = readFileSync(join(dir, found), 'utf8');
    } catch {
      /* unreadable → treat as no coverage evidence below */
    }
    if (!mentionsCommand(content, gate.cmd)) {
      return {
        ...base,
        pass: false,
        detail:
          `${found} present but never mentions the declared quality-gate command (${gate.source}: \`${gate.cmd}\`). ` +
          `Advisory: an instruction file that omits the gate it must pass every iteration is stale/thin. ` +
          `Add the build/test/lint commands (and any locked-core mandates) — route to the instructions agent to edit it.`,
      };
    }
  }
  return {
    ...base,
    pass: true,
    detail: gate
      ? `${found} present and mentions the declared gate (\`${gate.cmd}\`) — commands + locked-core available to the agent`
      : `${found} present — build/test/lint commands and locked-core mandates available to the agent`,
  };
}

/** Generic dispatch words that don't identify a script — a `<runner> run <script>` needs the script to be distinctive. */
const GENERIC_SUBCOMMANDS = new Set(['run', 'exec', '-c', '--']);

/**
 * The distinctive coverage needle for a gate command: `runner + subcommand`,
 * extended to the real target when the subcommand is a generic dispatch word
 * (`npm run <script>`). So `npm test` → "npm test", `go test …` → "go test",
 * but `npm run test:unit` → "npm run test:unit" (NOT the bare "npm run" prefix,
 * which would falsely match an unrelated `npm run build` in the file). `''` for
 * a single-token command (matched only by the whole-command check).
 */
function coverageNeedle(cmd: string): string {
  const toks = cmd.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (toks.length < 2) return '';
  const n = toks.length >= 3 && GENERIC_SUBCOMMANDS.has(toks[1]!) ? 3 : 2;
  return toks.slice(0, n).join(' ');
}

/**
 * True iff `content` mentions `cmd` — machine-greppable coverage. Matches the
 * whole command (whitespace-normalized, case-insensitive) OR its distinctive
 * needle (runner + subcommand / script), so a file that documents `npm test`
 * still covers a declared `npm test --silent` without a bare `npm run` prefix
 * covering an unrelated script.
 */
function mentionsCommand(content: string, cmd: string): boolean {
  const hay = content.toLowerCase().replace(/\s+/g, ' ');
  const full = cmd.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!full) return true;
  if (hay.includes(full)) return true;
  const needle = coverageNeedle(cmd);
  return needle !== '' && hay.includes(needle);
}

export { checkC5, checkC8 };
