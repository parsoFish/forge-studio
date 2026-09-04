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
 * Containment: `projectId` is PROJECT_ID_RE + length-cap validated before any fs
 * call, then resolved via `realpathSync` and required to land inside the
 * resolved `projectsRoot` (never a lexical prefix check on an unresolved
 * path). This is deliberately the SAME shape as
 * `packages/sessions/bridge-studio-sessions.ts`'s `resolveSafeSessionDir` — realpath the
 * candidate, compare against the realpath'd root with a `startsWith`
 * boundary check — and NOT `resolveGuardedPath`
 * (`cli/studio-path-guard.ts`)/`isContainedProjectRepoPath`
 * (`packages/flows/manifest-path-guard.ts`): those enforce a STRICTER per-segment
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

import { SESSION_STAGES } from '@forge/sessions/studio/session-kinds.ts';
import {
  safeReadFileInSession,
  type ContractStage,
  type ContractStageRow,
  type ContractStageStatus,
} from '@forge/sessions/studio/session-transcript.ts';
import { loadProjectConfig, AGENT_INSTRUCTION_FILES, type ProjectConfig } from './project-config.ts';
import { PROJECT_ID_RE, MAX_EXACT_ID_LENGTH } from '@forge/agents/skill-path.ts';
import { guardedFile } from '@forge/kernel';

export type { ContractStageRow, ContractStageStatus } from '@forge/sessions/studio/session-transcript.ts';

/** The D2 five-stage vocabulary, drawn from `SESSION_STAGES` (never a
 *  parallel vocabulary) — 'brain' excluded (project-brain owns it). */
export const CONTRACT_STAGE_ORDER: readonly ContractStage[] = Object.freeze(
  SESSION_STAGES.filter((s): s is ContractStage => s !== 'brain'),
);

export type DeriveContractStagesResult =
  | { readonly ok: true; readonly rows: ContractStageRow[]; readonly sourcesScanned: string[] }
  | { readonly ok: false; readonly error: { readonly message: string } };

const MAX_PROJECT_ID_LENGTH = MAX_EXACT_ID_LENGTH;
const COMPLIANCE_REPORT_REL_PATH = join('.forge', 'contract-compliance-report.json');
const DEMO_LOCK_REL_PATH = join('.forge', 'demo', 'demo.lock.json');
const ROADMAP_REL_PATH = 'roadmap.md';

/**
 * Real, per-call containment: `realpathSync` the candidate `<projectsRoot>/
 * <projectId>` and require the result to land inside the realpath'd
 * `projectsRoot` (equal, or prefixed by `projectsRoot + sep`). A missing
 * directory and an escaping symlink both collapse to `null` — the caller
 * cannot distinguish "wrong id" from "blocked escape" from the outcome,
 * mirroring `resolveSafeSessionDir` (`packages/sessions/bridge-studio-sessions.ts`). See
 * the module header for why this — not `resolveGuardedPath` — is the right
 * shape here (AT-28's false-rejection control).
 *
 * Exported (R4-17 round-1 BLOCKER fix): `POST /api/studio/onboarding/start`
 * (`apps/forge/ui-bridge.ts`) needs the IDENTICAL containment shape on the same
 * `projectsRoot`/project-id pair `GET /api/studio/projects/:id/
 * contract-stages` already resolves through this function — reused by import
 * rather than re-implemented, per this campaign's standing "one guard, many
 * callers" rule (see `apps/forge/ui-bridge.ts`'s call site for the full note).
 */
export function resolveContainedProjectDir(projectsRoot: string, projectId: string): string | null {
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
    // Wording ("gate command: <tokens>") is pinned to the
    // ALLOWED_DETAIL_PATTERNS allow-list shape (packages/projects/tests/integration/contract-stages.test.ts,
    // AT-23) — a fixed template, not a word choice being preserved for its
    // own sake.
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
  // Wording ("step: <kind>") is pinned to the ALLOWED_DETAIL_PATTERNS
  // allow-list shape (packages/projects/tests/integration/contract-stages.test.ts, AT-23) — a fixed
  // template, not a word choice being preserved for its own sake.
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

const BRAIN_PROFILE_FILENAME = 'profile.md';

/** Builds the `roadmap` stage row — a file that exists but is EMPTY is
 *  still `present` (bytes: 0); "present" answers "does the artifact exist",
 *  not "is it non-empty".
 *
 *  T2 ruling (round-1 pin 2, item 3): `checkC4` (HARD) in `packages/projects/preflight.ts`
 *  fails closed unless BOTH `roadmap.md` AND `brain/projects/<id>/
 *  profile.md` (Brain 3, ADR 035, central in the forge repo) exist, but this
 *  row previously only ever looked at `roadmap.md` — a project could read
 *  `roadmap: present` here while `forge preflight` failed it outright, with
 *  nothing in this row hinting why. `status` STAYS presence-of-roadmap.md
 *  ONLY (folding the brain profile in would be a clause verdict — D11
 *  forbids it, only `forge preflight`'s exit code is entitled to make that
 *  call), but the profile's real presence/absence is now always reported as
 *  a `detail` fact (never a verdict), and `source` additionally names the
 *  profile file whenever it is actually there to name (kept conditional,
 *  rather than unconditional, so the row's `source` stays exactly
 *  `'roadmap.md'` for every project with no brain profile at all — AT-17/18/
 *  19's pinned shape — and only grows to name a second file once there is a
 *  second real file to name). */
function deriveRoadmapRow(projectDir: string, forgeRoot: string, projectId: string): ContractStageRow {
  const body = safeReadFileInSession(projectDir, ROADMAP_REL_PATH);

  // SEC-04 (bd forge-ebj): the brain-profile presence probe now rides
  // `guardedFile` in read mode against the TRUSTED `forgeRoot` root, with
  // `projectId` (already PROJECT_ID_RE + length-cap validated by
  // `deriveContractStages`) as its OWN `segments[]` element — never folded into
  // the root — alongside the fixed `brain`/`projects`/`profile.md` literals.
  // `guardedFile` walks every segment with a realpath identity check + `nlink`
  // leaf check, so a symlinked `brain/projects/<projectId>` dir or a
  // symlinked/hardlinked `profile.md` leaf is refused (collapses to `null`)
  // rather than followed off-root — and it still leaks only a boolean presence
  // fact, never file content. (Unlike `resolveContainedProjectDir` above, the
  // project-repo path guard here is a NON-existence-oracle presence check on a
  // forge-owned tree, so the stricter per-segment identity semantics carry no
  // AT-28-style symlink-back-inside acceptance requirement.) `guardedFile`
  // never throws; a rejection is `null` == absent.
  const profilePresent =
    guardedFile(forgeRoot, ['brain', 'projects', projectId, BRAIN_PROFILE_FILENAME], 'read') !== null;
  const profileRelPath = `brain/projects/${projectId}/${BRAIN_PROFILE_FILENAME}`;
  const detail = [`brain profile: ${profilePresent ? 'present' : 'absent'} (${profileRelPath})`];
  const source = profilePresent ? `${ROADMAP_REL_PATH} + ${profileRelPath}` : ROADMAP_REL_PATH;

  if (body === null) {
    return { stage: 'roadmap', status: 'absent', source, detail, bytes: null };
  }
  return { stage: 'roadmap', status: 'present', source, detail, bytes: Buffer.byteLength(body, 'utf8') };
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
  const { forgeRoot, projectsRoot, projectId } = input;

  // W7-A4: the project id IS the directory name (case-preserving, exact —
  // PROJECT_ID_RE), so `trafficGame` resolves and `trafficgame` is unknown.
  if (projectId.length === 0 || projectId.length > MAX_PROJECT_ID_LENGTH || !PROJECT_ID_RE.test(projectId)) {
    return {
      ok: false,
      error: { message: `invalid project id ${JSON.stringify(projectId.slice(0, 60))} — must match ${PROJECT_ID_RE}` },
    };
  }

  const projectDir = resolveContainedProjectDir(projectsRoot, projectId);
  if (projectDir === null) {
    return { ok: false, error: { message: `unknown project "${projectId}"` } };
  }

  // SEC-04 leaf-tail: `loadProjectConfig` raw-reads `<projectDir>/.forge/
  // project.json` (`join` + `readFileSync`, NO per-leaf realpath — unlike
  // `safeReadFileInSession`, which realpath-contains every leaf it reads, so the
  // instructions/demo/roadmap rows are already symlink-safe). `projectDir` is
  // already realpath-contained under `projectsRoot` (`resolveContainedProjectDir`
  // above), so it is a TRUSTED root here — pass IT to `guardedFile`, never the
  // `projectsRoot`+`projectId` pair, so the projectId (already resolved) is NOT
  // re-run through the per-segment identity check and AT-28's symlink-back-inside
  // acceptance stays intact. Require the `.forge/project.json` leaf itself to pass
  // the guard before trusting the config read: a symlinked/hardlinked leaf (proven
  // to leak the OUTSIDE file's gate command into the `contract` row otherwise)
  // collapses to `null`, indistinguishable from a genuinely-absent config — both
  // the safe "not onboarded yet" outcome (`config = null`). A CONTAINED-but-
  // malformed project.json still reaches `loadProjectConfig` and fails the whole
  // derivation closed, unchanged.
  //
  // Residual (disclosed, same trust tier as this module's other realpath-not-
  // atomic notes): once the leaf is proven contained, `loadProjectConfig` also
  // raw-reads the `.forge/quality_gate_cmd` sidecar; a symlinked SIDECAR could
  // still fold cmd tokens in when project.json omits `cmd`. Closing that needs the
  // guard inside `loadProjectConfig` (a shared hot-path function, many callers) —
  // out of scope for this leaf-tail pass; tracked as an open concern.
  let config: ProjectConfig | null = null;
  if (guardedFile(projectDir, ['.forge', 'project.json'], 'read') !== null) {
    try {
      config = loadProjectConfig(projectDir);
    } catch (err) {
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  const rows: ContractStageRow[] = [
    deriveContractRow(projectDir, config),
    deriveInstructionsRow(projectDir),
    deriveSecretsRow(config),
    deriveDemoRow(projectDir, config),
    deriveRoadmapRow(projectDir, forgeRoot, projectId),
  ];

  const sourcesScanned = [
    '.forge/project.json (contract: testProcess.local.cmd) + .forge/contract-compliance-report.json',
    `${AGENT_INSTRUCTION_FILES.join(' | ')} (instructions)`,
    '.forge/project.json (secrets: testProcess.acceptance.requiresEnv — NAMES ONLY, never a value)',
    '.forge/project.json (demoProcess) + .forge/demo/demo.lock.json (built)',
    `roadmap.md + brain/projects/${projectId}/profile.md (C4 divergence visibility, not a verdict)`,
  ];

  return { ok: true, rows, sourcesScanned };
}
