/**
 * The project-brain BUILD — the knowledge half of what was
 * `orchestrator/project-brain-builder-runner.ts`.
 *
 * QUARRY:80 owns that runner to `knowledge` ("a knowledge concern wrapped in
 * the sessions turn-loop plumbing it must shed"), but the file cannot land
 * here whole: it dispatches an agent turn, so it imports `@forge/agents`
 * (rank 3) and `@forge/sessions` (rank 4), both above this package. So the
 * concern splits along the line that QUARRY note already drew, and this
 * module is the half that is genuinely about a brain:
 *
 *   - `buildAnalyzePlan` — the pure `{cwd, prompt}` plan, whose flow/band
 *     branch reads Brain 2's cycle archives (`cyclesRawDir`).
 *   - `commitProjectBrain` — staged themes into the central brain, the
 *     `kb.yaml` descriptor, and the index regeneration.
 *
 * WHAT DELIBERATELY STAYED BEHIND. `writeProjectBrainStatus` calls
 * `guardedWriteSessionStatus` and `statusWriteRefusalReason` from
 * `@forge/sessions` — session-lifecycle plumbing, not brain-building, and
 * exactly the seam between the two halves. So the commit no longer writes the
 * session status: it returns what it wrote, and the runner performs the phase
 * transition. That is the sharper split anyway — a module that knows nothing
 * about sessions should not be advancing one.
 *
 * THE TYPES ARE NARROWED ON PURPOSE. Both entry points take exactly the status
 * fields they read, never the runner's `ProjectBrainStatus`: that type carries
 * `modelTier?: ModelTier` from `@forge/agents`, and `check-boundaries` cruises
 * with `tsPreCompilationDeps: true` and no type/value distinction, so even a
 * type-only import of it is a layer violation from this package. The runner's
 * wider status satisfies both shapes structurally and passes straight through.
 */
import { guardedReadFile, guardedWriteFile, guardedReadDir } from '@forge/kernel';
import type { KbBinding } from '@forge/contracts/studio/types.ts';

import { loadKbDescriptor, serializeKbDescriptor } from './studio/kb-descriptor.ts';
import { regenerateBrainIndex } from './brain-index.ts';
import { cyclesRawDir } from './brain-paths.ts';

/**
 * The session kind-dir every project-brain session nests under. It lives here
 * because it names the on-disk layout of the staged themes this module reads;
 * the runner imports it back for its own guarded session-dir resolution.
 */
export const PROJECT_BRAIN_KIND_DIR = '_project-brain';

/** Exactly the status fields `buildAnalyzePlan` reads. */
export type ProjectBrainAnalyzeInput = {
  project: string;
  project_repo_path: string;
  prompt: string;
  kb_binding?: KbBinding;
};

/** Exactly the status fields `commitProjectBrain` reads. */
export type ProjectBrainCommitInput = {
  project: string;
  kb_id?: string;
  kb_binding?: KbBinding;
};

/**
 * R4-19 WI-1: pure `{cwd, prompt}` plan for the analyze-step agent turn.
 * Extracted from `runAnalyzeStep` (ADR-042 pure-function allowance) so the
 * read-source branch is directly testable without spinning up an agent turn.
 *
 * Branches on `status.kb_binding`:
 *   - a `flow` binding WITH a `band` (the create-kb-cycle case, e.g.
 *     `review-insights` bound to `{kind:'flow', ref:'forge-develop',
 *     band:'review-band'}`) has NO project repo to read — its evidence is
 *     the forge-owned cycle archives (Brain 2, `cyclesRawDir`) plus the
 *     review-band / adversarial-review findings logged inside them.
 *   - every other binding shape (`project`, `unique`, a `flow` binding
 *     WITHOUT a band, or no `kb_binding` at all — the historical default)
 *     stays on the ordinary project-repo read.
 *
 * R4-23 WI-3: the task PROSE for each branch (the `## Your task this turn:
 * …` header, the evidence-source sentence, the closing write-contract
 * instruction) now lives in `skills/project-brain-builder/SKILL.md` as the
 * `analyze-project-repo` / `analyze-cycle-archives` turn sections (ADR-024 —
 * SKILL.md is the single source of intent). This function selects the right
 * turn id per branch via `skillFor` and composes it with DATA ONLY (project
 * name, working directory, staging directory, operator guidance, and —
 * replacing the old inline `${binding.ref}` / `${binding.band}`
 * interpolation into the prose — the `Evidence flow:` / `Evidence band:`
 * data lines the SKILL.md prose now names instead of embedding).
 */
export function buildAnalyzePlan(
  status: ProjectBrainAnalyzeInput,
  forgeRoot: string,
  staging: string,
  skillFor: (turnId: string) => string,
): { cwd: string; prompt: string } {
  const binding = status.kb_binding;
  if (binding?.kind === 'flow' && binding.band) {
    const cwd = cyclesRawDir(forgeRoot);
    const prompt = [
      skillFor('analyze-cycle-archives'),
      '',
      `Project: ${status.project}`,
      `Cycle archives (your working directory — READ from here): ${cwd}`,
      `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging}`,
      '',
      'Operator focus / guidance:',
      status.prompt || '_(none — author a faithful, well-rounded initial brain)_',
      '',
      `Evidence flow: ${binding.ref}`,
      `Evidence band: ${binding.band}`,
    ].join('\n');
    return { cwd, prompt };
  }

  const cwd = status.project_repo_path;
  const prompt = [
    skillFor('analyze-project-repo'),
    '',
    `Project: ${status.project}`,
    `Project repo (your working directory — READ from here): ${status.project_repo_path}`,
    `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging}`,
    '',
    'Operator focus / guidance:',
    status.prompt || '_(none — author a faithful, well-rounded initial brain)_',
  ].join('\n');
  return { cwd, prompt };
}

/** SEC-04 leaf: the staged-themes readdir routed through the guard (leaf dir
 *  included) — a symlinked `themes/` collapses to null → []. */
export function listStagedThemes(projectRoot: string, sessionId: string): string[] {
  const entries = guardedReadDir(projectRoot, [PROJECT_BRAIN_KIND_DIR, sessionId, 'themes']);
  if (entries === null) return [];
  return entries.filter((f) => f.endsWith('.md')).sort();
}

export function commitProjectBrain(args: {
  projectRoot: string;
  sessionId: string;
  forgeRoot: string;
  status: ProjectBrainCommitInput;
}): { wrote: string[]; themes: string[] } {
  const { projectRoot, sessionId, forgeRoot, status } = args;
  const staged = listStagedThemes(projectRoot, sessionId);

  // R1-06 WI-2 (T1 ruling Q4 option (a)): honor a descriptor-derived binding
  // when this session carries one (the POST /api/studio/kbs create hand-off,
  // F2) — never silently re-derive `{ kind: 'project', ref: status.project }`.
  // Absent a descriptor (the ordinary, non-KB-scoped project-brain flow), the
  // fallback IS that historical default, unchanged.
  //
  // `kb_id` present ⇔ this session is a POST /api/studio/kbs create hand-off.
  const isCreateHandoff = status.kb_id !== undefined;
  const kbId = status.kb_id ?? status.project;
  const binding: KbBinding = status.kb_binding ?? { kind: 'project', ref: status.project };

  // Brain-dir resolution MUST agree with what POST /api/studio/kbs already
  // scaffolded, or the descriptor splits in two (one empty kb.yaml at the
  // create location, one seeded kb.yaml here) and every operator-authored theme
  // is silently orphaned. Create scaffolds brain/<id> UNCONDITIONALLY for EVERY
  // binding kind (cli/bridge-studio-kbs.ts create route), so a create hand-off
  // commits into brain/<kbId> REGARDLESS of binding.kind — resolveKbBrainDir
  // (orchestrator/brain-paths.ts) resolves it there. Only the ORDINARY
  // project-brain flow (no hand-off, kbId === status.project, a real project)
  // targets the central per-project brain brain/projects/<project> (ADR 035).
  //
  // SEC-04: `kbId` is request-derived (either `status.project` or a
  // descriptor's own id) — it rides as its OWN guarded segment against the
  // TRUSTED forgeRoot below, NEVER folded into a root (the root-folding bypass
  // the guard cannot self-detect).
  const brainSegs = isCreateHandoff ? ['brain', kbId] : ['brain', 'projects', kbId];

  const wrote: string[] = [];
  for (const file of staged) {
    // Source: a staged theme leaf the agent authored under the session dir.
    // Route the READ through the guard (a symlinked staged file → null → skip),
    // and route the central-brain WRITE through the guard too (kb id +
    // filename as guarded segments). `file` is a readdir entry name, so it is a
    // single safe path component by construction.
    const contents = guardedReadFile(projectRoot, [PROJECT_BRAIN_KIND_DIR, sessionId, 'themes', file]);
    if (contents === null) continue; // unreadable / escaping staged leaf — skip
    const destSegs = file === 'profile.md' ? [...brainSegs, 'profile.md'] : [...brainSegs, 'themes', file];
    const dest = guardedWriteFile(forgeRoot, destSegs, contents);
    if (dest === null) {
      throw new Error(
        `project-brain runner: refusing to commit — destination for "${file}" failed containment (kb="${kbId}").`,
      );
    }
    wrote.push(dest);
  }

  // Ensure a kb.yaml descriptor exists so the brain is discoverable.
  // Existence + write both routed through the guard (kb id folded as a
  // segment, not the root).
  const existingKb = guardedReadFile(forgeRoot, [...brainSegs, 'kb.yaml']);
  if (existingKb === null) {
    const kbDest = guardedWriteFile(
      forgeRoot,
      [...brainSegs, 'kb.yaml'],
      serializeKbDescriptor({
        id: kbId,
        name: `${kbId} Brain`,
        binding,
        desc: binding.kind === 'project' ? `Per-project brain for ${kbId}.` : `Brain for ${kbId}.`,
        path: '',
      }),
    );
    if (kbDest === null) {
      throw new Error(
        `project-brain runner: refusing to commit — kb.yaml for "${kbId}" failed containment.`,
      );
    }
    // Loud self-check (parity with project-brain-seed): a malformed kb.yaml
    // fails the commit rather than shipping an undiscoverable brain.
    loadKbDescriptor(kbDest);
    wrote.push(kbDest);
  }

  try { regenerateBrainIndex({ cwd: forgeRoot }); } catch { /* index regen best-effort */ }

  return { wrote, themes: staged };
}
