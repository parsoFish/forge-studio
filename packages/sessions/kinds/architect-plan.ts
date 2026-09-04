/**
 * Architect plan-doc operator artefact — renderer + writer.
 *
 * Stage S2A of the 2026-05-20 refinement batch. The architect's terminal step
 * is "write `PLAN.md` (+ sibling `PLAN.html`) to
 * `<projectRepoPath>/_architect/<session-id>/` for the operator to review."
 *
 * Contracts honoured:
 *  - C12  — PLAN.md location is `<projectRoot>/_architect/<session-id>/PLAN.md`.
 *  - C19  — aggregate footprint is INFORMATIONAL ONLY (no gate, no threshold,
 *           no auto-escalation). The renderer pins this in the section title
 *           and body language; the test suite asserts the vocabulary.
 *
 * Cwc amendments (2026-05-24, see S2A-CWC-AMENDMENTS.md):
 *  - Amendment 1: the rendered "Operator brief + interview" section captures
 *    a paraphrase paragraph (session.vision) + a Q&A table from any
 *    `AskUserQuestion` rounds the architect ran (session.interview).
 *  - Amendment 2: `renderPlanHtml(session)` emits a zero-dep, single-file,
 *    inline-CSS HTML viewer next to PLAN.md. PLAN.md remains the only parse
 *    target; PLAN.html is read-only.
 *
 * Pure I/O surface:
 *  - `renderPlanDoc(session)`           — returns markdown string
 *  - `renderPlanHtml(session)`          — returns HTML string
 *  - `writePlanDoc(session, root)`      — returns PLAN.md path (also writes PLAN.html)
 *
 * The PLAN is reviewed + approved on the in-UI `/artifact?run=_architect-<sid>&type=plan` gate
 * (ADR 020/023); the operator's verdict comes through the bridge, not via
 * PLAN.md annotations.
 */

import { mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { guardedWriteFile, resolveGuardedPath, PathGuardContainmentError, type PathGuardOk } from '@forge/kernel';
import { renderPlanHtml } from './architect-plan-html.ts';


// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProposedInitiative = {
  initiative_id: string;
  project: string;
  project_repo_path: string;
  title: string;
  iteration_budget: number;
  cost_budget_usd: number;
  /** Optional informational cost estimate surfaced in the aggregate footprint (C19). */
  estimated_cost_usd?: number;
  /** Initiative-level dependencies on other initiatives (mirrors manifest.ts). */
  depends_on_initiatives?: string[];
  /** Raw manifest body — preserved verbatim in the PLAN.md drawer; carries GWT ACs. */
  body: string;
};

export type CouncilTranscript = {
  flags: unknown[];
  escalations: unknown[];
  perCritic: unknown[];
  totalCostUsd: number;
};

export type BrainContextEntry = {
  /** Path under `brain/` that was consulted. */
  path: string;
  /** One-line summary of why this entry was relevant. */
  summary: string;
};

/** One round of the front-of-architect `AskUserQuestion` interview (cwc Amendment 1). */
export type InterviewRound = {
  /** The question the architect asked. */
  question: string;
  /** The operator's chosen answer; or `[operator skipped]` if they declined. */
  answer: string;
};

export type ArchitectSession = {
  /** `YYYY-MM-DDTHH-mm-ss`. */
  session_id: string;
  /** Project name (matches `manifest.project`). */
  project: string;
  /** Path to the project repo on disk. */
  project_repo_path: string;
  /** The operator's vision / brief, paraphrased back. */
  vision: string;
  /**
   * Interview Q&A rounds the architect ran with `AskUserQuestion` before
   * drafting (cwc Amendment 1). Empty array = no rounds, operator drafted
   * directly. The architect SKILL mandates ≥1 round in practice; the
   * renderer renders an empty array as `_no interview rounds — operator
   * drafted directly_`.
   */
  interview?: InterviewRound[];
  /** Brain entries the architect consulted while drafting (ARCH-1). */
  brain_context: BrainContextEntry[];
  /** Raw council output (flags / escalations / per-critic + total cost). */
  council: CouncilTranscript;
  /**
   * The exploration stage's findings (R4-04-F4): enumerated edge cases with
   * dispositions + brain-sourced constraints. Optional — a fail-open
   * exploration leaves it absent and the PLAN renders without the section.
   */
  explore?: {
    edgeCases: { title: string; detail: string; disposition: string }[];
    brainConstraints: { constraint: string; source: string }[];
    exploreSummary: string;
  };
  /** One or more drafted initiatives — NOT yet written to `_queue/pending/`. */
  initiatives: ProposedInitiative[];
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderPlanDoc(session: ArchitectSession): string {
  const parts: string[] = [];

  parts.push(`# Architect plan — ${session.session_id}`);
  parts.push('');
  parts.push(`- Project: \`${session.project}\``);
  parts.push(`- Repo: \`${session.project_repo_path}\``);
  parts.push('');

  // Operator quick-start — the plan is reviewed + approved on the in-UI plan
  // gate. W7-B7 (artifact-plan-30): the gate lives on the /artifact plan
  // surface — the old /architect/<sid> screen was retired (M7-4 / ADR-031).
  parts.push(
    '> **Operator review.** This plan is presented at `/artifact?run=_architect-' + session.session_id +
      '&type=plan` in Forge Studio. Read each section there, then click **approve**, **revise**, ' +
      'or **reject** — the runner finalizes your verdict, promoting the manifests to the queue only on approve.',
  );
  parts.push('');

  // --- Operator brief + interview (cwc Amendment 1) ---
  parts.push('## Operator brief + interview');
  parts.push('');
  parts.push(session.vision.trim());
  parts.push('');
  parts.push('### Interview');
  parts.push('');
  const rounds = session.interview ?? [];
  if (rounds.length === 0) {
    parts.push('_No interview rounds — operator drafted directly._');
  } else {
    parts.push('| # | Question | Operator answer |');
    parts.push('|---|---|---|');
    rounds.forEach((r, i) => {
      const q = r.question.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const a = r.answer.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      parts.push(`| ${i + 1} | ${q} | ${a} |`);
    });
  }
  parts.push('');

  // --- Edge cases + constraints (R4-04-F4 exploration stage) ---
  if (session.explore && (session.explore.edgeCases.length > 0 || session.explore.brainConstraints.length > 0)) {
    parts.push('## Edge cases & constraints (exploration stage)');
    parts.push('');
    if (session.explore.exploreSummary) {
      parts.push(session.explore.exploreSummary);
      parts.push('');
    }
    if (session.explore.edgeCases.length > 0) {
      parts.push('| # | Edge case | Disposition | Detail |');
      parts.push('|---|-----------|-------------|--------|');
      session.explore.edgeCases.forEach((ec, i) => {
        const t = ec.title.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        const d = ec.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        parts.push(`| ${i + 1} | ${t} | ${ec.disposition} | ${d} |`);
      });
      parts.push('');
    }
    if (session.explore.brainConstraints.length > 0) {
      parts.push('Brain-sourced constraints shaping the ACs:');
      for (const bc of session.explore.brainConstraints) {
        parts.push(`- ${bc.constraint} _(source: ${bc.source})_`);
      }
      parts.push('');
    }
  }

  // --- Brain context ---
  parts.push('## Brain context');
  parts.push('');
  if (session.brain_context.length === 0) {
    parts.push('_No brain entries consulted (brain-gap event emitted)._');
  } else {
    for (const entry of session.brain_context) {
      parts.push(`- \`${entry.path}\` — ${entry.summary}`);
    }
  }
  parts.push('');

  // --- Proposed initiatives ---
  parts.push('## Proposed initiatives');
  parts.push('');
  parts.push('| ID | Title | Iteration budget | Depends on |');
  parts.push('|---|---|---|---|');
  for (const init of session.initiatives) {
    const dep = (init.depends_on_initiatives ?? []).join(', ') || '—';
    parts.push(
      `| \`${init.initiative_id}\` | ${init.title} | ${init.iteration_budget} | ${dep} |`,
    );
  }
  parts.push('');

  // Per-initiative drawer with the full manifest body
  for (const init of session.initiatives) {
    parts.push(`### ${init.initiative_id} — drawer`);
    parts.push('');
    parts.push('```markdown');
    parts.push(init.body.trimEnd());
    parts.push('```');
    parts.push('');
  }

  // --- Aggregate footprint (C19 — informational only) ---
  parts.push('## Aggregate footprint (informational)');
  parts.push('');
  parts.push(
    '_This block surfaces the **informational** footprint of the proposed initiatives — ' +
      'how many cycles + dollars they would consume if every one were queued today. ' +
      'It is informational only; forge does not enforce a budget or block at any number._',
  );
  parts.push('');
  const totalIterations = session.initiatives.reduce((s, i) => s + i.iteration_budget, 0);
  const knownCostInitiatives = session.initiatives.filter((i) => typeof i.estimated_cost_usd === 'number');
  const totalEstimatedCost = knownCostInitiatives.reduce((s, i) => s + (i.estimated_cost_usd ?? 0), 0);
  parts.push(`- Initiatives proposed: **${session.initiatives.length}**`);
  parts.push(`- Total iteration budget: **${totalIterations}**`);
  if (knownCostInitiatives.length === session.initiatives.length && session.initiatives.length > 0) {
    parts.push(`- Total estimated cost: **$${totalEstimatedCost.toFixed(2)}**`);
  } else if (knownCostInitiatives.length > 0) {
    parts.push(
      `- Total estimated cost (partial — ${knownCostInitiatives.length}/${session.initiatives.length} initiatives have estimates): **$${totalEstimatedCost.toFixed(2)}**`,
    );
  }
  parts.push('');

  // --- Footer breadcrumb ---
  parts.push('---');
  parts.push('');
  parts.push(
    `_Generated by the architect runner on ${new Date().toISOString()}. ` +
      'Reviewed + approved on the `/architect` screen in the forge UI._',
  );
  parts.push('');

  return parts.join('\n');
}


// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write PLAN.md + sibling PLAN.html for a session. Returns the absolute path
 * to the written `PLAN.md`. Creates the parent directory as needed.
 * C12: location is `<projectRoot>/_architect/<sid>/`.
 *
 * Two artefacts per session:
 *  - `PLAN.md`   — operator's annotation surface (parsed by the CLI)
 *  - `PLAN.html` — read-only rich viewer (cwc Amendment 2)
 */
export function writePlanDoc(session: ArchitectSession, projectRoot: string): string {
  // SEC-04 leaf: `session.session_id` is request-derived — contain it (and the
  // `_architect` kind-dir + each leaf) as their OWN guarded segments against the
  // TRUSTED `projectRoot`, NEVER folded into the root (the root-folding bypass
  // the guard cannot self-detect). guardedWriteFile mkdirs the parent and routes
  // the WHOLE opened path (leaf included) through the guard, so a symlinked
  // PLAN.md / PLAN.html leaf cannot escape the session dir.
  const planPath = guardedWriteFile(
    projectRoot,
    ['_architect', session.session_id, 'PLAN.md'],
    renderPlanDoc(session),
  );
  if (planPath === null) {
    throw new Error(
      `architect writePlanDoc: PLAN.md write failed containment for session "${session.session_id}" — refusing to write.`,
    );
  }
  // Sibling rich viewer (cwc Amendment 2). Operator opens in browser; never
  // read back as input — PLAN.md is the only parse target.
  const htmlPath = guardedWriteFile(
    projectRoot,
    ['_architect', session.session_id, 'PLAN.html'],
    renderPlanHtml(session),
  );
  if (htmlPath === null) {
    throw new Error(
      `architect writePlanDoc: PLAN.html write failed containment for session "${session.session_id}" — refusing to write.`,
    );
  }
  return planPath;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Convenience: read the session dir layout (used by the CLI)
// ---------------------------------------------------------------------------

export type SessionPaths = {
  sessionDir: string;
  planPath: string;
  feedbackPath: string;
  manifestsDir: string;
};

const ARCHITECT_DIRNAME = '_architect';
const ARCHIVED_DIRNAME = '_archived';

export function sessionPaths(projectRoot: string, sessionId: string): SessionPaths {
  const sessionDir = resolve(projectRoot, '_architect', sessionId);
  return {
    sessionDir,
    planPath: join(sessionDir, 'PLAN.md'),
    feedbackPath: join(sessionDir, 'feedback.md'),
    manifestsDir: join(sessionDir, 'manifests'),
  };
}

/** `resolveGuardedPath`, with a rejection turned into a typed refusal. Never a
 *  cast: the narrowing is what makes `.realPath` reachable at all (§15.66).
 *  `r.reason` is NOT forwarded — `path-guard.ts` declares it an internal
 *  diagnostic that must never reach an untrusted caller, and it can carry the
 *  caller's own bytes (a newline in a segment is log-injection material). */
function guardedOrRefuse(root: string, segments: readonly string[]): PathGuardOk {
  const r = resolveGuardedPath(root, segments);
  if (!r.ok) throw new PathGuardContainmentError('archiveSessionDir: refusing to archive — path containment rejected');
  return r;
}

/**
 * Move a session dir to `_architect/_archived/<session-id>/`. Used by the
 * CLI on `reject`. Returns the archived path.
 *
 * `sessionId` rides as its OWN guarded segment, for the source AND the target.
 * Containment a function inherits from its callers is not containment it can
 * rely on: this one is exported, and the next caller need not be a runner.
 */
export function archiveSessionDir(projectRoot: string, sessionId: string): string {
  const source = guardedOrRefuse(projectRoot, [ARCHITECT_DIRNAME, sessionId]);
  if (!source.exists) throw new Error(`archiveSessionDir: session dir not found: ${sessionId}`);
  const archived = guardedOrRefuse(projectRoot, [ARCHITECT_DIRNAME, ARCHIVED_DIRNAME]);
  if (!archived.exists) mkdirSync(archived.realPath, { recursive: true });
  // The target walks from `projectRoot` with ALL THREE segments, not from
  // `archived.realPath`. A derived root is trusted IMPLICITLY — the guard runs
  // no identity check on its own root — so re-entering it would leave `_archived`
  // verified before the mkdir and unverified after it, and a symlink planted in
  // that window would be adopted as the trusted root. Re-walking is what the
  // guard's own docstring calls the defect this repo has closed five times.
  const target = guardedOrRefuse(projectRoot, [ARCHITECT_DIRNAME, ARCHIVED_DIRNAME, sessionId]);
  if (target.exists) throw new Error(`archiveSessionDir: target already exists: ${sessionId}`);
  renameSync(source.realPath, target.realPath);
  return target.realPath;
}
