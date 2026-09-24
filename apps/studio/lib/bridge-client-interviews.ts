/**
 * `forge-8vfn.7.6.135` — the operator-interview client surface, split out of
 * `bridge-client.ts` (pure move; the exported shape is unchanged, only which
 * file declares it). Covers every file-checkpointed runner an operator drives
 * through a question-form: architect, instructions-creator, demo-builder,
 * project-brain, authoring, and reflection.
 */
import { bridgePost, bridgeReadOr404, bridgeReadOrThrow, resolveBridgeUrl } from './bridge-client-core.ts';
// W8-A2 (ON-7 defect 1) — type-only import (erased at compile time): safe
// against the reverse VALUE import (`session-lifecycle-client.ts` imports
// `bridgeFetch` from the `bridge-client.ts` hub, which re-exports this file)
// because a `type`-only edge never participates in module evaluation order.
import type { SessionLifecycle } from './session-lifecycle-client.ts';

// ---- Architect (ADR 020) -------------------------------------------------

export type ArchitectPhase =
  | 'interviewing'
  | 'awaiting-answers'
  | 'exploring'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

export type ArchitectQuestion = {
  /** W7-C2 T1 review (A3, finding sessions-kinds-19) — the correlation
   *  handle, posted back with this question's answer so the durable record
   *  binds by ID, not by question TEXT. The GENERIC session interview always
   *  carries one (the bridge derives it from the question's position in
   *  questions.json — `pendingQuestionId`, packages/sessions/bridge-studio-sessions.ts,
   *  and `parsePendingQuestionsMeta` REQUIRES it). Architect's own bespoke
   *  interview wire (`/api/architect/...`) declares no ids at all, so this
   *  is optional at the TYPE level and simply absent there — not a
   *  fallback: a question with no declared id has nothing honest to send,
   *  and the generic route only demands one where a real question list
   *  exists to correlate against. */
  id?: string;
  question: string;
  header: string;
  /** Options may be absent when the architect poses an open-ended question. */
  options?: { label: string; description: string }[];
};

export type CompletenessCriticFinding = {
  severity: 'high' | 'medium' | 'low';
  /** Omitted for a finding that spans the whole plan (no single owner). */
  initiativeId?: string;
  gap: string;
};

/** Result of the architect-completeness-critic FINALIZE gate. Presence means
 *  the critic already ran for this session (one-shot-per-session). */
export type CompletenessCriticStatus = {
  ranAt: string;
  findings: CompletenessCriticFinding[];
  crashed?: boolean;
};

export type ArchitectSessionSummary = {
  sessionId: string;
  project: string;
  projectRepoPath: string;
  phase: ArchitectPhase;
  round: number;
  idea: string;
  questions: ArchitectQuestion[] | null;
  planUrl: string | null;
  /** Milliseconds since the last sign of life (heartbeat mtime or status.updated_at).
   *  Use this to detect a stalled runner. Derived from `lifecycle.idleMs`
   *  (W8-A2, ON-7 defect 1) rather than an independent calculation — kept
   *  for wire compatibility with `isSessionStale` (architect-hex.ts). */
  staleMs?: number;
  /**
   * W8-A2 (ON-7 defect 1) — the derived session lifecycle (state/needsYou/
   * error/idleMs/cancellable — `packages/sessions/bridge-studio-lifecycle.ts`), the SAME
   * derivation the aggregate `/api/studio/sessions` index already carried;
   * `GET /api/architect/sessions` never called it before. `error` is the
   * runner's own crash message (only for `state: 'crashed'`) —
   * `SessionArchitectPanel`'s stuck warning renders THIS, not a log path.
   * Additive-optional (declared-data-fails-open guard): absent only if the
   * registry itself could not resolve the 'architect' descriptor, which
   * never happens for the real studio/session-kinds.yaml.
   */
  lifecycle?: SessionLifecycle;
  /** Null until the critic has run for this session. */
  completenessCritic: CompletenessCriticStatus | null;
  /**
   * W7-A3 (sessions-kinds-08/12, artifact-plan-22/23): the initiative ids this
   * session drafted, DERIVED by the bridge from `<session>/manifests/*.md` at
   * read time (nothing stored). Present on every phase; `[]` before the
   * architect has drafted anything.
   */
  initiativeIds?: string[];
};

export async function fetchArchitectSessions(): Promise<ArchitectSessionSummary[]> {
  const body = await bridgeReadOrThrow<{ sessions?: ArchitectSessionSummary[] }>('/api/architect/sessions');
  return body.sessions ?? [];
}

/** Absolutise a bridge-relative `planUrl` (e.g. `/api/architect/file/...`) for
 *  an iframe `src`. Returns '' when no bridge is configured. */
export async function architectFileUrl(relative: string): Promise<string> {
  const base = await resolveBridgeUrl();
  return base ? `${base}${relative}` : '';
}

export async function startArchitect(input: {
  project: string;
  idea: string;
  /** ADR-043 §3: operator-chosen tier (validated server-side vs the architect SKILL envelope). */
  modelTier?: string;
  /** W7-B6 (projects-14): session cost ceiling (USD) — enforced by the runner at every turn start. */
  costCeilingUsd?: number;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const r = await bridgePost('/api/architect/start', input);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined };
}

export async function postArchitectAnswers(input: {
  project: string;
  sessionId: string;
  answers: { question: string; answer: string }[];
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/architect/answer', input);
}

/** R4-11-T5 — StuckWarning's one-click re-run: re-spawns the existing
 *  session's turn as-is (no answers/round mutation). Mirrors
 *  `postArchitectAnswers`'s bridgePost shape. */
export async function rerunArchitectSession(
  project: string,
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/architect/rerun', { project, sessionId });
}

export type PlanVerdict = {
  project: string;
  sessionId: string;
  kind: 'approve' | 'revise' | 'reject';
  rationale?: string;
};

export async function postPlanVerdict(input: PlanVerdict): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/plan-verdict', input);
}

// ---- Instructions-creator (Stage A) --------------------------------------
//
// Mirrors the architect client: an operator-driven, file-checkpointed runner
// that authors a managed project's AGENTS.md (interview → draft → verdict →
// finalize).

export type InstructionsPhase =
  | 'briefing'
  | 'interviewing'
  | 'awaiting-answers'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

export type InstructionsSessionSummary = {
  sessionId: string;
  project: string;
  projectRepoPath: string;
  phase: InstructionsPhase;
  /** 'init' (no AGENTS.md yet) or 'edit' (carries the existing file as context). */
  mode: 'init' | 'edit';
  round: number;
  prompt: string;
  questions: ArchitectQuestion[] | null;
  /** Existing AGENTS.md content (edit mode) shown on the briefing screen, or null. */
  currentInstructions: string | null;
  /** The agent-instruction file backing `currentInstructions` (e.g. 'AGENTS.md'), or null. */
  currentInstructionsFile: string | null;
  /** Bridge-relative URL to the pending AGENTS.draft.md, or null until drafted. */
  draftUrl: string | null;
  /** Milliseconds since the last sign of life (heartbeat mtime or status.updated_at).
   *  Use this to detect a stalled runner. Derived from `lifecycle.idleMs`
   *  (W8-A2, ON-7 defect 1). */
  staleMs?: number;
  /** W8-A2 (ON-7 defect 1) — see `ArchitectSessionSummary.lifecycle`'s doc
   *  comment; the same wiring for `GET /api/instructions/sessions`. */
  lifecycle?: SessionLifecycle;
};

export async function listInstructionsSessions(): Promise<InstructionsSessionSummary[]> {
  const body = await bridgeReadOrThrow<{ sessions?: InstructionsSessionSummary[] }>('/api/instructions/sessions');
  return body.sessions ?? [];
}

/**
 * Open a new instructions session in phase 'briefing' (does NOT spawn the agent).
 * `mode: 'edit'` carries the existing AGENTS.md as context; `'init'` creates one.
 * The operator reviews on the session shell, then kicks off via the generic
 * `question-form` affordance the `briefing` phase derives (W6-B9,
 * `postSessionAffordance('instructions', sessionId, 'briefing-question-form', ...)`,
 * `@/lib/session-client`) — `POST /api/instructions/brief` (the bespoke route
 * this used to read a dedicated `instructionsBrief` client function for) is
 * unchanged server-side but has no remaining forge-ui caller.
 */
export async function startInstructions(input: {
  project: string;
  mode: 'init' | 'edit';
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — an operator-chosen kickoff
   *  model tier, validated server-side against instructions-creator's own
   *  SKILL.md-declared envelope (`resolveKickoffModelTier`). Omit for the
   *  spec's spawn-default tier. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; mode?: 'init' | 'edit'; error?: string }> {
  const r = await bridgePost('/api/instructions/start', {
    project: input.project, mode: input.mode,
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined,
    mode: (r.data?.mode === 'init' || r.data?.mode === 'edit') ? r.data.mode : undefined,
  };
}

// W6-B9 — `instructionsBrief`/`answerInstructions`/`instructionsVerdict`
// (the bespoke `/api/instructions/{brief,answer,verdict}` client wrappers)
// are RETIRED here — their sole caller, `SessionInstructionsPanel`, is
// deleted; every instructions affordance now POSTs through the generic
// `postSessionAffordance` (`@/lib/session-client`) instead. The three bridge
// routes themselves are unchanged server-side (still real, independently
// tested bridge surface — apps/forge/tests/regression/ui-bridge-instructions.test.ts) — only their
// forge-ui client wrappers had no remaining caller.

// ---- Demo-builder (Stage B) ----------------------------------------------
//
// Mirrors the instructions client: an operator-driven, file-checkpointed runner
// that authors a managed project's DEMO.html (generate → review → lock). The
// DEMO.html lives in the project repo (.forge/demo/), served via `demoUrl`.

export type DemoBuilderPhase =
  | 'briefing'
  | 'generating'
  | 'awaiting-review'
  | 'locking'
  | 'locked'
  | 'abandoned';

export type DemoSessionSummary = {
  sessionId: string;
  project: string;
  projectRepoPath: string;
  phase: DemoBuilderPhase;
  /** 'create' (no locked demo yet) or 'update' (carries the existing demo as context). */
  mode: 'create' | 'update';
  /** When set, the session is iterating ONE demo-element kind (per-element iteration). */
  targetElement: string | null;
  /** True when the project already has a reproducible demo locked in (.forge/demo/). */
  hasLockedDemo: boolean;
  iteration: number;
  prompt: string;
  /** Bridge-relative URL to the generated DEMO.html, or null until generated. */
  demoUrl: string | null;
  /** Element ids that have a rendered fragment in the repo
   *  (.forge/demo/fragments/<id>.html) — each viewable independently. */
  fragments: string[];
  /** Milliseconds since the last sign of life (heartbeat mtime or status.updated_at).
   *  Use this to detect a stalled runner. Derived from `lifecycle.idleMs`
   *  (W8-A2, ON-7 defect 1). */
  staleMs?: number;
  /** W8-A2 (ON-7 defect 1) — see `ArchitectSessionSummary.lifecycle`'s doc
   *  comment; the same wiring for `GET /api/demo-builder/sessions`. */
  lifecycle?: SessionLifecycle;
};

/** Bridge-relative URL serving one element's rendered fragment for a demo session. */
export function demoFragmentUrl(project: string, sessionId: string, element: string): string {
  return `/api/demo-builder/fragment/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(element)}`;
}

/** R4-16: bridge-relative URL serving one file out of a specific demo
 *  generation snapshot (`GET /api/demo-builder/generation/<project>/<sid>/
 *  <n>/<filename>`, apps/forge/ui-bridge.ts). `generation` is the snapshot's own
 *  recorded number (GenerationGalleryEntry.number), never an array index. */
export function demoGenerationFileUrl(project: string, sessionId: string, generation: number, filename: string): string {
  return `/api/demo-builder/generation/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}/${generation}/${encodeURIComponent(filename)}`;
}

export async function listDemoSessions(): Promise<DemoSessionSummary[]> {
  const body = await bridgeReadOrThrow<{ sessions?: DemoSessionSummary[] }>('/api/demo-builder/sessions');
  return body.sessions ?? [];
}

/** A previously-locked demo snapshot for a project (newest first). */
export type DemoHistoryEntry = {
  id: string;
  /** Bridge-relative path serving the snapshotted DEMO.html (use architectFileUrl). */
  demoUrl: string;
  lockedAt: string | null;
  prompt: string;
  iterations: number | null;
};

/** List a project's previously-locked demos (snapshots under .forge/demo/history/). */
export async function listDemoHistory(project: string): Promise<DemoHistoryEntry[]> {
  const body = await bridgeReadOrThrow<{ history?: DemoHistoryEntry[] }>(
    `/api/demo-builder/history/${encodeURIComponent(project)}`,
  );
  return body.history ?? [];
}

/**
 * Open a new demo session in phase 'briefing' (does NOT spawn the agent).
 * `mode: 'update'` carries the existing locked demo as context; `'create'` builds one.
 * The operator reviews on the briefing screen, then kicks off via {@link demoBuilderBrief}.
 */
export async function startDemoBuilder(input: {
  project: string;
  mode: 'create' | 'update';
  /** Iterate ONE demo-element kind (per-element iteration); omit to compose the full demo. */
  targetElement?: string;
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — see {@link startInstructions}'s
   *  own doc; validated against demo-builder's own SKILL.md envelope. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; mode?: 'create' | 'update'; error?: string }> {
  const r = await bridgePost('/api/demo-builder/start', {
    project: input.project, mode: input.mode,
    ...(input.targetElement ? { targetElement: input.targetElement } : {}),
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined,
    mode: (r.data?.mode === 'create' || r.data?.mode === 'update') ? r.data.mode : undefined,
  };
}

/** Record briefing notes and kick off the demo agent (briefing → generating). */
export async function demoBuilderBrief(input: {
  project: string;
  sessionId: string;
  brief: string;
  /** Override/narrow the per-element iteration target for this run. */
  targetElement?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/brief', input);
}

// --- R1-3b — agentic project-brain builder ----------------------------------

export type ProjectBrainSession = {
  session_id: string;
  project: string;
  phase: 'briefing' | 'analyzing' | 'awaiting-review' | 'committing' | 'committed' | 'abandoned';
  prompt: string;
  /** W8-A2 (ON-7 defect 1) — see `ArchitectSessionSummary.lifecycle`'s doc
   *  comment. `GET /api/project-brain/sessions` served `statuses` VERBATIM
   *  before this fix — no lifecycle AND no staleness of any kind, the
   *  worst of the four bespoke list routes. */
  lifecycle?: SessionLifecycle;
};

/** Start a project-brain builder session (phase=briefing). */
export async function startProjectBrain(input: {
  project: string;
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — see {@link startInstructions}'s
   *  own doc; validated against project-brain-builder's own SKILL.md envelope. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const r = await bridgePost('/api/project-brain/start', {
    project: input.project,
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined };
}

/** Record the operator's focus + kick off the analysis (briefing → analyzing). */
export async function projectBrainBrief(input: { project: string; sessionId: string; brief: string }): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/project-brain/brief', input);
}

/** Approve the staged themes → commit into the central brain (awaiting-review → committing). */
export async function projectBrainApprove(input: { project: string; sessionId: string }): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/project-brain/approve', input);
}

/** Abandon a project-brain session. */
export async function projectBrainAbandon(input: { project: string; sessionId: string }): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/project-brain/abandon', input);
}

/** Fetch all project-brain sessions. */
export async function fetchProjectBrainSessions(): Promise<ProjectBrainSession[]> {
  const body = await bridgeReadOrThrow<{ sessions?: ProjectBrainSession[] }>('/api/project-brain/sessions');
  return body.sessions ?? [];
}

/** Fetch the staged theme files for a session under review. */
export async function fetchStagedThemes(project: string, sessionId: string): Promise<Array<{ name: string; content: string }>> {
  const body = await bridgeReadOrThrow<{ themes?: Array<{ name: string; content: string }> }>(
    `/api/project-brain/themes/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}`,
  );
  return body.themes ?? [];
}

// ---- Authoring (R4-21 T3, BLOCKER-2 fix — the creation-agent session) ----

/**
 * Start an authoring session (kind: 'authoring', agent: creation-agent) —
 * mirrors {@link startProjectBrain}/{@link startInstructions}'s shape
 * exactly: POSTs the operator's own words (never a fabricated form-field
 * label) and returns the real, server-minted `sessionId`. The session is a
 * scratch working directory only — `project` picks WHERE the session's
 * bookkeeping lives (the generic session-shell's `<project>/_<kind>/<id>`
 * convention every kind uses), not what the drafted skill/hook belongs to;
 * skills and hooks are forge-wide, project-agnostic library artifacts.
 */
export async function startAuthoring(input: {
  project: string;
  prompt: string;
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — see {@link startInstructions}'s
   *  own doc; validated against creation-agent's own SKILL.md envelope. */
  modelTier?: string;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const r = await bridgePost('/api/studio/authoring/start', {
    project: input.project, prompt: input.prompt,
    ...(input.modelTier ? { modelTier: input.modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, sessionId: typeof r.data?.sessionId === 'string' ? r.data.sessionId : undefined };
}

// W8-B4 FIX-1 — `finalizeAuthoring()` (a typed wrapper over the DEDICATED
// `POST /api/studio/authoring/finalize` route, packages/library/bridge-studio-authoring.ts)
// was removed here: `git grep -n finalizeAuthoring forge-ui/ cli/ orchestrator/
// scripts/` found ZERO callers anywhere in the codebase — the real Approve
// path has gone through the GENERIC verdict route (`postSessionAffordance`
// -> `handleAuthoringVerdict` -> `runFinalize`, cli/bridge-studio-affordances.ts)
// since W6-B9, and nothing in forge-ui ever called this function to reach the
// dedicated route directly. It had also drifted stale (`kind: 'skill' |
// 'hook'` only — would have silently dropped a `kind:'template'` response,
// W8-B4/WI-3) BECAUSE it had no caller exercising it; keeping a zero-caller
// wrapper around is exactly how that kind of drift recurs invisibly. The
// dedicated server route + its own acceptance suite
// (packages/library/tests/integration/bridge-studio-authoring-finalize.test.ts) are UNCHANGED and remain a
// legitimate, independently-tested API surface — only this orphaned client
// wrapper is gone, per the task brief's "do not leave a third half-wired
// path": a function with no caller is not a caller that should exist.

// W8-B5b WI-3 — `startCommunityRefresh()` (a typed wrapper over the RETIRED
// interactive `POST /api/studio/community-refresh/start` route, the W6-CR-3
// community-refresh LLM agent session kind) was removed here: that whole
// session kind is gone (`studio/session-kinds.yaml` entry,
// `skills/community-refresh/SKILL.md`, the `/sessions/community-refresh/new`
// kickoff branch) in favour of the deterministic, LLM-free `forge community
// refresh` / `POST /api/studio/community/refresh` (NO hyphen) shipped by
// W8-B5 — see the `finalizeAuthoring()` removal note just above this one for
// the standing rationale: a function with no caller is not a caller that
// should exist, and this one's sole caller (`app/sessions/[kind]/new/page.tsx`'s
// `community-refresh` branch) is retired in the same lane.

/** One demo-element kind from the forge library (the demoProcess composition palette). */
export type DemoElementSummary = {
  id: string;
  name: string;
  phase: 'capture' | 'verify' | 'present';
  description: string;
  configHint: string;
};

/** List the forge demo-element library (skill-creating skills) for the composer palette. */
export async function listDemoElements(): Promise<DemoElementSummary[]> {
  const body = await bridgeReadOrThrow<{ elements?: DemoElementSummary[] }>('/api/studio/demo-elements');
  return body.elements ?? [];
}

export async function demoBuilderFeedback(input: {
  project: string;
  sessionId: string;
  feedback: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/feedback', input);
}

export async function demoBuilderLock(input: {
  project: string;
  sessionId: string;
  /** R4-16 (D6): names which generation snapshot to lock — validated
   *  server-side (integer >= 1) BEFORE any write. Omitted = lock the
   *  current/live sample (the pre-R4-16 behaviour, unchanged). */
  generation?: number;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/lock', input);
}

export async function demoBuilderAbandon(input: {
  project: string;
  sessionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost('/api/demo-builder/abandon', input);
}

// ---- Reflection (the third human moment, in-UI) -------------------------

/**
 * A reflection question. Structurally an ArchitectQuestion plus R4-09-F3
 * automated-mode provenance: in automated mode the reflector self-answers
 * each question from the cycle logs/demo/diff, so `answer` carries the
 * inferred answer and `inferred: true` flags it for read-only rendering.
 * Both absent in interactive mode.
 */
export type ReflectionQuestion = ArchitectQuestion & {
  answer?: string;
  inferred?: boolean;
};

export type ReflectionData = {
  cycleId: string;
  questions: ReflectionQuestion[];
  answered: boolean;
  /**
   * R4-09-F3: the durable reflect mode (from the backend's reflect-mode
   * sidecar). The authoritative signal for the automated read-only view —
   * robust to per-question inferred-marker compliance. Absent on pre-F3
   * cycles ⇒ fall back to the per-question inferred heuristic.
   */
  mode?: 'interactive' | 'automated';
};

export async function fetchReflection(cycleId: string): Promise<ReflectionData | null> {
  return bridgeReadOr404<ReflectionData>(`/api/reflect/${encodeURIComponent(cycleId)}`);
}

export async function postReflectionAnswers(input: {
  cycleId: string;
  answers: { question: string; answer: string }[];
  freeform?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return bridgePost(`/api/reflect/${encodeURIComponent(input.cycleId)}/answer`, {
    answers: input.answers,
    freeform: input.freeform,
  });
}
