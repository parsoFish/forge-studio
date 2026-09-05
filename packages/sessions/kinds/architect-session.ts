/**
 * The architect session's SHARED VOCABULARY — its agent spec, its types, and
 * the guarded status/interview/decision IO every step reads and writes.
 *
 * Split out of `kinds/architect.ts` (M4 exit row 5, ruling 96). This is the
 * base of the three-way split: `architect-manifest.ts` and `architect-steps.ts`
 * both depend on it, the parent depends on it, and it depends on NONE of them.
 *
 * TWO NAMES WERE MOVED HERE TO DISSOLVE CYCLES the range-only seam would have
 * created, and the cycle probe is what found them:
 *
 *  - `architectAgentSpec` / `ARCHITECT_MODEL` were declared in the parent and
 *    used 4x by the steps, so leaving them there made `steps -> parent` while
 *    the parent already imported the steps.
 *  - `DraftInitiative` was declared inside the steps and used by the manifest
 *    builder, so leaving it there made `manifest -> steps` while the steps
 *    already called `buildManifest`.
 *
 * Both now sit under the module both sides already depend on, and the four
 * modules form a DAG: session <- manifest <- steps <- parent.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import type { QueryFn } from '../interactive-session.ts';
import type { InterviewRound } from './architect-plan.ts';
import { resolveGuardedPath, guardedFile, guardedReadFile, guardedWriteFile } from '@forge/kernel';
import type { EventLogger } from '@forge/kernel';
import type { ArchitectManifestPorts } from './architect-ports.ts';
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import type { ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import type { CompletenessCriticFinding } from './architect-critic.ts';
import { skillPathRelative } from '@forge/agents/skill-path.ts';


// ---------------------------------------------------------------------------
// ADR-024 / M2-4: spec derived from skills/architect/SKILL.md (single source)
// ---------------------------------------------------------------------------

/**
 * The architect's PhaseAgentSpec — derived from SKILL.md frontmatter so the
 * model tier and tool allow-list have one source of truth (ADR-024).
 */
export const architectAgentSpec = deriveAgentSpec(skillPathRelative('architect'));

/** Concrete model id resolved from the spec's tier. */
export const ARCHITECT_MODEL = modelForSpec(architectAgentSpec);

// ---------------------------------------------------------------------------
// Session-dir state contract
// ---------------------------------------------------------------------------

export type ArchitectPhase =
  | 'interviewing'
  | 'awaiting-answers'
  | 'exploring'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

/**
 * Result of the architect-completeness-critic FINALIZE gate (ADR ref:
 * brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md).
 * Presence on `ArchitectStatus` means the critic has ALREADY run for this
 * session — one-shot-per-session: a subsequent finalize turn skips the critic
 * and promotes straight through. The operator's re-approve after findings IS
 * the acknowledgement; there is no separate UI action.
 */
export type CompletenessCriticStatus = {
  ranAt: string;
  findings: CompletenessCriticFinding[];
  /** True when the critic turn crashed (advisory infra; treated as zero
   *  findings — finalize still proceeds to promote). */
  crashed?: boolean;
};

export type ArchitectStatus = {
  session_id: string;
  project: string;
  project_repo_path: string;
  phase: ArchitectPhase;
  /** 1-based interview round counter. */
  round: number;
  /** The operator's raw idea (also persisted to `idea.md`). */
  idea: string;
  updated_at: string;
  completenessCritic?: CompletenessCriticStatus;
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam): an
   * operator-chosen model tier, validated by the bridge's `/api/architect/
   * start` route against `architectAgentSpec` (`strategy:fixed`, so the only
   * legal value is the fixed model's own tier) before it is ever persisted
   * here. Absent ⇒ unchanged default behavior (`ARCHITECT_MODEL`).
   */
  modelTier?: ModelTier;
  /**
   * W7-B6 (projects-14 / sessions-kinds-03): operator-declared cost ceiling
   * (USD) for the WHOLE session, validated by `POST /api/architect/start`
   * (finite, > 0, <= MAX_KICKOFF_COST_CEILING_USD) before it is persisted.
   * Enforced by `runArchitectTurn` at every turn start: when the session's
   * accumulated event-log cost (`readArchitectSessionStats`) has reached the
   * ceiling, the turn REFUSES to start (an `error` event + a thrown error the
   * session lifecycle surfaces) instead of silently overrunning. Absent ⇒ no
   * ceiling (unchanged default).
   */
  costCeilingUsd?: number;
};

/** One operator-facing question — the reflector's `StructuredQuestion` shape so
 *  the UI form renderer is shared. */
export type ArchitectQuestion = {
  question: string;
  /** ≤12 chars chip label (AskUserQuestion constraint). */
  header: string;
  options: { label: string; description: string }[];
};

/** One round of answers POSTed by the operator (written by the bridge). */
export type AnswerRound = {
  round: number;
  answers: { question: string; answer: string }[];
};

// ---------------------------------------------------------------------------
// Runner I/O
// ---------------------------------------------------------------------------

export type RunArchitectTurnInput = {
  sessionId: string;
  projectRoot: string;
  /** Manifest functions bound at `apps/forge` — see ArchitectManifestPorts.
   *  Absent ⇒ any turn reaching manifest work REFUSES (never a fallback). */
  manifestPorts?: ArchitectManifestPorts;
  /** Inject a fake `query` for tests. Defaults to the SDK. */
  queryFn?: QueryFn;
  /** `_logs/` root; defaults to `<cwd>/_logs`. */
  logsRoot?: string;
  /** `_queue/` root; defaults to `<cwd>/_queue`. */
  queueRoot?: string;
  /** Logger override (tests). */
  logger?: EventLogger;
  /** Path to the architect skill (prompt source — ADR 003). */
  skillPromptPath?: string;
  /** Safety cap on interview rounds before forcing a draft. Default 4. */
  maxInterviewRounds?: number;
  /**
   * Forge root for brain-index loading (ARCH-1). Defaults to `process.cwd()`.
   * Override in tests / bench so the brain index loads from the correct root.
   */
  brainCwd?: string;
};

export type RunArchitectTurnResult = {
  /** Phase the session is in AFTER this turn. */
  phase: ArchitectPhase;
  /** Files written this turn. */
  wrote: string[];
  /** Present when the turn ended needing operator answers. */
  questions?: ArchitectQuestion[];
  /** Present when the turn produced a plan. */
  planPath?: string;
  /** Present when the turn finalized (manifests promoted to the queue). */
  promotedManifestPaths?: string[];
};
export type DraftInitiative = {
  slug: string;
  title: string;
  iteration_budget: number;
  cost_budget_usd: number;
  /**
   * Slugs of OTHER initiatives in this same draft that must merge before this
   * one is claimed (build order). Maps to the manifest's
   * `depends_on_initiatives` (F-25 scheduler gate). Empty = runs in parallel.
   */
  depends_on?: string[];
  /**
   * ADR 051 — the change class this initiative is. Required of the architect:
   * it selects the gate profile the work is judged by, and there is no default
   * to fall back to. `buildManifest` refuses a draft that omits it.
   */
  class: 'code' | 'docs' | 'config' | 'infra';
  /**
   * ADR 051 — typed acceptance criteria. Required of the architect and carried
   * verbatim onto the manifest, where the PM compiles them into work items,
   * review returns a verdict per entry and PLAN.html renders them. This is the
   * field that retires `extractGwtBlocks`: criteria are DECLARED, not recovered
   * from prose by regex.
   */
  acceptance_criteria: ReadonlyArray<{ given: string; when: string; then: string }>;
  body: string;
};

// ---------------------------------------------------------------------------
// SEC-04 — the ONLY architect status accessors.
//
// These take the TRUSTED `projectsRoot` plus the request-derived directory
// segments (`project`, `'_architect'`, `sessionId`) as their OWN `segments[]`
// elements — never folded into the root — and route the WHOLE path,
// `status.json` leaf included, through `guardedFile`, so a symlinked or
// hardlinked status leaf is rejected. Return `null` on a containment rejection
// (fail closed).
//
// They replaced a raw `readStatus`/`writeStatus` pair in `kinds/architect.ts`
// that raw-appended the `status.json` leaf to an already-built `sessionDir`
// — the "guard the dir, raw-append the leaf" shape SEC-04 closes. The
// Phase-1 appliers moved every production call site onto these; the raw pair
// then survived as test-fixture scaffolding only, and was deleted with the M4
// exit door (ruling 129). `kind-turn-log-contract.test.ts` locks the property
// that `kinds/architect.ts` names no `status.json` leaf of its own.
// ---------------------------------------------------------------------------

export function guardedReadStatus(
  projectsRoot: string,
  dirSegments: readonly string[],
  leaf = 'status.json',
): ArchitectStatus | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'read');
  if (p === null) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ArchitectStatus;
  } catch {
    return null;
  }
}

export function guardedWriteStatus(
  projectsRoot: string,
  dirSegments: readonly string[],
  status: ArchitectStatus,
  leaf = 'status.json',
): string | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'write');
  if (p === null) return null;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
  return p;
}


// SEC-04 leaf: `questions.json`/`answers.json`/`edge-cases.json`/`feedback.md`
// each ride the WHOLE `<projectsRoot>/_architect/<sessionId>/<leaf>` path
// (leaf included) through `guardedFile` — the trusted `projectsRoot` root plus
// the request-derived `sessionId` as its OWN segment (never folded into root).
// A symlinked/hardlinked LEAF inside a genuinely real, contained session dir is
// refused: writes throw (fail closed, runner contract), reads collapse to
// empty/null (no out-of-root disclosure). Replaces the former raw
// `join(sessionDir, leaf)` helpers that guarded neither dir nor leaf.
export function writeQuestions(projectsRoot: string, sessionId: string, questions: ArchitectQuestion[]): string {
  const p = guardedWriteFile(
    projectsRoot,
    ['_architect', sessionId, 'questions.json'],
    JSON.stringify(questions, null, 2),
  );
  if (p === null) {
    throw new Error(
      'architect runner: questions.json write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
  return p;
}

/** Read every `answers.json` round into a flat `InterviewRound[]`. The bridge
 *  appends rounds; this flattens them into the `ArchitectSession.interview`
 *  shape the renderer expects. SEC-04: the `answers.json` leaf rides through the
 *  guard (read mode) so a symlinked leaf discloses nothing — a rejected or
 *  absent file both collapse to `[]`. */
export function readInterview(projectsRoot: string, sessionId: string): InterviewRound[] {
  const raw = guardedReadFile(projectsRoot, ['_architect', sessionId, 'answers.json']);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as AnswerRound[] | AnswerRound;
    const rounds = Array.isArray(parsed) ? parsed : [parsed];
    const out: InterviewRound[] = [];
    for (const r of rounds) {
      for (const a of r.answers ?? []) {
        out.push({ question: a.question, answer: a.answer });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Read `feedback.md` into a markdown block the draft step bakes into the
 *  regenerated manifests. Returns the trimmed content or null if absent/empty. */
export function readResolvedDecisions(projectsRoot: string, sessionId: string): string | null {
  const raw = guardedReadFile(projectsRoot, ['_architect', sessionId, 'feedback.md']);
  if (raw === null) return null;
  const fb = raw.trim();
  return fb || null;
}

/** Discover every architect session under `projects/<name>/_architect/<sid>/`
 *  — used by the bridge's `GET /api/architect/sessions`. Best-effort; never
 *  throws on a malformed dir. */
export function listArchitectSessions(projectsRoot: string): ArchitectStatus[] {
  const out: ArchitectStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  for (const project of safeReaddir(projectsRoot)) {
    // SEC-04: guard the `_architect` dir as its OWN segment against the fixed
    // `projectsRoot` base — a symlinked `projects/<p>/_architect` (a plain
    // 120000 blob committable to a project repo) resolves to an identity
    // mismatch and yields NO enumeration/disclosure. This was THE reproduced
    // escape: `GET /api/architect/sessions` enumerated an out-of-root session
    // and disclosed its status.json (idea / session_id / project_repo_path).
    const archGuard = resolveGuardedPath(projectsRoot, [project, '_architect']);
    if (!archGuard.ok) continue;
    const archDir = archGuard.realPath;
    for (const sid of safeReaddir(archDir)) {
      if (sid.startsWith('_')) continue; // skip _archived/
      // Guard each session id as its own segment too — a symlinked `<sid>`
      // resolving out of root is refused, never read.
      // SEC-04 leaf: route the WHOLE `<sid>/status.json` path (leaf included)
      // through the guard — the earlier pass guarded the sid DIR but read the
      // status.json leaf raw via `readStatus(sidGuard.realPath)`, so a symlinked
      // `status.json` inside a real, contained sid dir still disclosed an
      // out-of-root file. `guardedReadStatus` refuses that leaf (null), so it is
      // never enumerated.
      const status = guardedReadStatus(projectsRoot, [project, '_architect', sid]);
      if (status) out.push(status);
    }
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// P4: architect session stats (cost + duration from the session event log)
// ---------------------------------------------------------------------------

type ArchitectSessionStats = { cost_usd: number; duration_ms: number };

/**
 * P4: Read the architect session's own event log (`_logs/_architect-<sid>/events.jsonl`)
 * and compute:
 *   - `cost_usd`:    sum of all numeric `cost_usd` fields across events.
 *   - `duration_ms`: last `started_at` minus first `started_at`, in ms.
 *
 * Returns `null` if the log is absent, empty, or unparseable — best-effort so
 * a missing log never blocks manifest promotion.
 */
export function readArchitectSessionStats(
  logsRoot: string,
  sessionId: string,
): ArchitectSessionStats | null {
  const logPath = join(resolve(logsRoot), `_architect-${sessionId}`, 'events.jsonl');
  if (!existsSync(logPath)) return null;
  try {
    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean);
    if (lines.length === 0) return null;

    let totalCost = 0;
    let firstTs: number | null = null;
    let lastTs: number | null = null;

    for (const line of lines) {
      const ev = JSON.parse(line) as Record<string, unknown>;
      if (typeof ev.cost_usd === 'number') totalCost += ev.cost_usd;
      if (typeof ev.started_at === 'string') {
        const t = new Date(ev.started_at).getTime();
        if (!Number.isNaN(t)) {
          if (firstTs === null || t < firstTs) firstTs = t;
          if (lastTs === null || t > lastTs) lastTs = t;
        }
      }
    }

    const duration_ms = firstTs !== null && lastTs !== null ? lastTs - firstTs : 0;
    return { cost_usd: totalCost, duration_ms };
  } catch {
    return null;
  }
}
