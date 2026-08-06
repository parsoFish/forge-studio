/**
 * `deriveContractStages` — the onboarding session's data contract (R4-17, D2,
 * D9). Reports ARTIFACT PRESENCE for the five onboarding stages
 * (`contract, instructions, secrets, demo, roadmap` — `SESSION_STAGES` minus
 * `brain`, D2), never a clause verdict (D11): `forge preflight`'s exit code
 * is the only authoritative contract-green signal
 * (`brain/forge-dev/themes/forge-project-onboarding-contract.md`), and this
 * module never re-implements that judgement.
 *
 * Lives beside `preflight.ts` / `bridge-studio-writes.ts`, where
 * project-contract knowledge already lives — zero new `orchestrator/`
 * modules (D4). All five rows are ALWAYS returned, in declared order — an
 * absent artifact yields a `status: 'absent'` row that still names its
 * source; a dropped row would be indistinguishable from "we never looked".
 *
 * The row TYPE (`ContractStageRow`) is declared in
 * `orchestrator/studio/session-transcript.ts`, not here, and re-exported —
 * see that module's header for why (one canonical owner; the direction this
 * file already needs for `safeReadFileInSession`/`SESSION_STAGES`).
 *
 * D3 (security, load-bearing): secrets are NAMES ONLY. This module NEVER
 * opens `secrets.env` and NEVER reads an env VALUE — the `secrets` stage's
 * status/detail are derived exclusively from `.forge/project.json`'s
 * `testProcess.acceptance.requiresEnv` (declared NAMES), read through the
 * canonical `orchestrator/project-config.ts` validator like every other
 * config-backed stage.
 *
 * Fail-closed contract: `.forge/project.json` ABSENT is a normal, expected
 * input (a never-onboarded project) — `{ok:true}` with the config-backed
 * stages `absent`. `.forge/project.json` PRESENT but malformed (bad JSON, or
 * failing the real `testProcess.local.cmd` requirement) fails the WHOLE
 * derivation closed — `{ok:false}`, carrying no `rows` a careless caller
 * could read past the `ok` check. An unknown/escaping `projectId` is a
 * DISTINCT `{ok:false}` from "project exists but nothing onboarded yet".
 *
 * Containment: `projectId` is SLUG_RE + length-cap validated before any fs
 * call, then resolved via `realpathSync` and required to land inside the
 * resolved `projectsRoot` (never a lexical prefix check on an unresolved
 * path). This is deliberately the SAME shape as
 * `cli/bridge-studio-sessions.ts`'s `resolveSafeSessionDir` — realpath the
 * candidate, compare against the realpath'd root with a `startsWith`
 * boundary check — and NOT `resolveGuardedPath`
 * (`cli/studio-path-guard.ts`)/`isContainedProjectRepoPath`
 * (`cli/manifest-path-guard.ts`): those enforce a STRICTER per-segment
 * IDENTITY check (a symlinked `<root>/<id>` pointing at a DIFFERENT real
 * object under the SAME root is rejected outright, by design — see
 * `studio-path-guard.ts`'s "escape shape 3"). That stricter shape would
 * reject the exact case this module's own AT-28 requires to be ACCEPTED (a
 * relative symlink that resolves back inside `projectsRoot`) — a real
 * conflict between the two guards' semantics, not an oversight; see the T3
 * report for the full note.
 */

import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

import { SESSION_STAGES } from '../orchestrator/studio/session-kinds.ts';
import {
  safeReadFileInSession,
  type ContractStage,
  type ContractStageRow,
  type ContractStageStatus,
} from '../orchestrator/studio/session-transcript.ts';
import { loadProjectConfig, AGENT_INSTRUCTION_FILES, type ProjectConfig } from '../orchestrator/project-config.ts';
import { SLUG_RE, MAX_SKILL_ID_LENGTH } from '../orchestrator/skill-path.ts';

export type { ContractStageRow, ContractStageStatus } from '../orchestrator/studio/session-transcript.ts';

/** The D2 five-stage vocabulary, drawn from `SESSION_STAGES` (never a
 *  parallel vocabulary) — 'brain' excluded (project-brain owns it). */
export const CONTRACT_STAGE_ORDER: readonly ContractStage[] = Object.freeze(
  SESSION_STAGES.filter((s): s is ContractStage => s !== 'brain'),
);

export type DeriveContractStagesResult =
  | { readonly ok: true; readonly rows: ContractStageRow[]; readonly sourcesScanned: string[] }
  | { readonly ok: false; readonly error: { readonly message: string } };

const MAX_PROJECT_ID_LENGTH = MAX_SKILL_ID_LENGTH;
const COMPLIANCE_REPORT_REL_PATH = join('.forge', 'contract-compliance-report.json');
const DEMO_LOCK_REL_PATH = join('.forge', 'demo', 'demo.lock.json');
const ROADMAP_REL_PATH = 'roadmap.md';

/**
 * Real, per-call containment: `realpathSync` the candidate `<projectsRoot>/
 * <projectId>` and require the result to land inside the realpath'd
 * `projectsRoot` (equal, or prefixed by `projectsRoot + sep`). A missing
 * directory and an escaping symlink both collapse to `null` — the caller
 * cannot distinguish "wrong id" from "blocked escape" from the outcome,
 * mirroring `resolveSafeSessionDir` (`cli/bridge-studio-sessions.ts`). See
 * the module header for why this — not `resolveGuardedPath` — is the right
 * shape here (AT-28's false-rejection control).
 */
function resolveContainedProjectDir(projectsRoot: string, projectId: string): string | null {
  let realProjectsRoot: string;
  try {
    realProjectsRoot = realpathSync(projectsRoot);
  } catch {
    return null;
  }
  const candidate = join(projectsRoot, projectId);
  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return null; // unknown project id — no such directory, or a dangling symlink
  }
  if (realCandidate !== realProjectsRoot && !realCandidate.startsWith(realProjectsRoot + sep)) {
    return null; // escapes projectsRoot via a symlink
  }
  return realCandidate;
}

/** Builds the `contract` stage row. `config === null` means `.forge/
 *  project.json` is absent entirely — a normal, expected "not onboarded
 *  yet" input, never a failure. */
function deriveContractRow(projectDir: string, config: ProjectConfig | null): ContractStageRow {
  const detail: string[] = [];
  let status: ContractStageStatus = 'absent';
  if (config !== null) {
    status = 'present';
    // NB: avoid the word "declared" here — it contains the D11-forbidden
    // substring "red" ("decla-RED"), which AT-23 greps for literally.
    detail.push(`gate command: ${config.testProcess.local.cmd.join(' ')}`);
    if (safeReadFileInSession(projectDir, COMPLIANCE_REPORT_REL_PATH) !== null) {
      detail.push('a compliance report file exists at .forge/contract-compliance-report.json');
    }
  }
  return { stage: 'contract', status, source: '.forge/project.json', detail, bytes: null };
}

/** Builds the `instructions` stage row — AGENTS.md preferred, CLAUDE.md
 *  (the contract's named legacy alias, docs/forge-project-contract.md C8)
 *  accepted. `bytes` is the real length of whichever file is actually
 *  found, read off disk (never estimated). */
function deriveInstructionsRow(projectDir: string): ContractStageRow {
  for (const filename of AGENT_INSTRUCTION_FILES) {
    const body = safeReadFileInSession(projectDir, filename);
    if (body !== null) {
      return {
        stage: 'instructions',
        status: 'present',
        source: filename,
        detail: [`source file: ${filename}`],
        bytes: Buffer.byteLength(body, 'utf8'),
      };
    }
  }
  return { stage: 'instructions', status: 'absent', source: AGENT_INSTRUCTION_FILES.join(' | '), detail: [], bytes: null };
}

/** Builds the `secrets` stage row — D3: NAMES ONLY, driven by
 *  `requiresEnv.length > 0`, never by whether the surrounding `acceptance`
 *  block exists. `secrets.env` is never opened. */
function deriveSecretsRow(config: ProjectConfig | null): ContractStageRow {
  const requiresEnv = config?.testProcess.acceptance?.requiresEnv ?? [];
  const status: ContractStageStatus = requiresEnv.length > 0 ? 'present' : 'absent';
  return { stage: 'secrets', status, source: '.forge/project.json', detail: [...requiresEnv], bytes: null };
}

/** Builds the `demo` stage row — present iff EITHER `demoProcess[]` is
 *  declared OR `.forge/demo/demo.lock.json` exists (declared-only, before
 *  the demo is ever built, is legitimately present — it names an intent). */
function deriveDemoRow(projectDir: string, config: ProjectConfig | null): ContractStageRow {
  const demoSteps = config?.demoProcess ?? [];
  // NB: "step: <kind>" not "declared step" — "declared"/"configured" both
  // contain the D11-forbidden substring "red", which AT-23 greps for.
  const detail: string[] = demoSteps.map((step) => `step: ${step.kind}`);
  let status: ContractStageStatus = demoSteps.length > 0 ? 'present' : 'absent';

  const lockRaw = safeReadFileInSession(projectDir, DEMO_LOCK_REL_PATH);
  if (lockRaw !== null) {
    status = 'present';
    try {
      const parsedLock: unknown = JSON.parse(lockRaw);
      if (parsedLock !== null && typeof parsedLock === 'object' && !Array.isArray(parsedLock)) {
        const demoSkill = (parsedLock as Record<string, unknown>).demo_skill;
        if (typeof demoSkill === 'string' && demoSkill.length > 0) {
          detail.push(`built demo skill: ${demoSkill}`);
        }
      }
    } catch {
      // Unparseable lock — its mere presence still counts (the lock exists);
      // never fabricate a demo_skill line for it, never crash.
    }
  }
  return { stage: 'demo', status, source: '.forge/project.json + .forge/demo/demo.lock.json', detail, bytes: null };
}

/** Builds the `roadmap` stage row — a file that exists but is EMPTY is
 *  still `present` (bytes: 0); "present" answers "does the artifact exist",
 *  not "is it non-empty". */
function deriveRoadmapRow(projectDir: string): ContractStageRow {
  const body = safeReadFileInSession(projectDir, ROADMAP_REL_PATH);
  if (body === null) {
    return { stage: 'roadmap', status: 'absent', source: ROADMAP_REL_PATH, detail: [], bytes: null };
  }
  return { stage: 'roadmap', status: 'present', source: ROADMAP_REL_PATH, detail: [], bytes: Buffer.byteLength(body, 'utf8') };
}

/**
 * Derives the five D2 stage rows for one project. See the module header for
 * the full fail-closed/containment contract.
 */
export function deriveContractStages(input: {
  forgeRoot: string;
  projectsRoot: string;
  projectId: string;
}): DeriveContractStagesResult {
  const { projectsRoot, projectId } = input;

  if (projectId.length === 0 || projectId.length > MAX_PROJECT_ID_LENGTH || !SLUG_RE.test(projectId)) {
    return {
      ok: false,
      error: { message: `invalid project id ${JSON.stringify(projectId.slice(0, 60))} — must match ${SLUG_RE}` },
    };
  }

  const projectDir = resolveContainedProjectDir(projectsRoot, projectId);
  if (projectDir === null) {
    return { ok: false, error: { message: `unknown project "${projectId}"` } };
  }

  let config: ProjectConfig | null;
  try {
    config = loadProjectConfig(projectDir);
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
  }

  const rows: ContractStageRow[] = [
    deriveContractRow(projectDir, config),
    deriveInstructionsRow(projectDir),
    deriveSecretsRow(config),
    deriveDemoRow(projectDir, config),
    deriveRoadmapRow(projectDir),
  ];

  const sourcesScanned = [
    '.forge/project.json (contract: testProcess.local.cmd) + .forge/contract-compliance-report.json',
    `${AGENT_INSTRUCTION_FILES.join(' | ')} (instructions)`,
    '.forge/project.json (secrets: testProcess.acceptance.requiresEnv — NAMES ONLY, never a value)',
    '.forge/project.json (demoProcess) + .forge/demo/demo.lock.json (built)',
    'roadmap.md',
  ];

  return { ok: true, rows, sourcesScanned };
}
