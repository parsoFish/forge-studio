/**
 * Architect plan-doc operator artefact — renderer + feedback parser + writer.
 *
 * Stage S2A of the 2026-05-20 refinement batch. The architect's terminal step
 * is no longer "write manifests to `_queue/pending/`" — it's "write `PLAN.md`
 * to `<projectRepoPath>/_architect/<session-id>/PLAN.md` for the operator to
 * review."
 *
 * Contracts honoured:
 *  - C12  — PLAN.md location is `<projectRoot>/_architect/<session-id>/PLAN.md`.
 *  - C19  — aggregate footprint is INFORMATIONAL ONLY (no gate, no threshold,
 *           no auto-escalation). The renderer pins this in the section title
 *           and body language; the test suite asserts the vocabulary.
 *  - C26  — if the session carries a `project_metrics` block (from
 *           `.forge/project.json`), the rendered PLAN.md surfaces the metric
 *           command + baselines_dir + tolerance alongside the manifest.
 *  - C27  — every session carries `type: 'implementation' | 'exploration'`.
 *           Exploration manifests render `parameter_space` + `hypothesis` +
 *           `metric_command` + `locked_baselines` and label `iteration_budget`
 *           as a hint not a contract.
 *
 * Annotation format (operator-edits-this-file flow):
 *  - Top-of-file:  `<!-- verdict: approve | revise | reject -->`
 *  - Inline:       `<!-- review: free text up to next --> -->`
 *
 * These mirror the proven `pr-as-sole-review-window` pattern from the
 * reviewer phase — HTML comments are invisible in rendered markdown, easy to
 * grep, and don't perturb the manifest body content.
 *
 * Pure I/O surface:
 *  - `renderPlanDoc(session)`           — returns markdown string
 *  - `writePlanDoc(session, root)`      — returns absolute path
 *  - `parseFeedbackComments(planPath)`  — returns { verdict, annotations }
 *  - `bundleFeedbackAsMarkdown(anns)`   — returns markdown feedback.md body
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Flag, Escalation, CriticVerdict } from '../skills/architect-llm-council/council.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InitiativeType = 'implementation' | 'exploration';

export type ProposedFeature = {
  feature_id: string;
  title: string;
  depends_on: string[];
};

export type ExplorationFields = {
  /** Markdown bullet list describing the parameter space. */
  parameter_space: string;
  /** One-line hypothesis the exploration is testing. */
  hypothesis: string;
  /** The metric command (same shape as `quality_gate_cmd`). */
  metric_command: string[];
  /** Paths to the baseline files this exploration is measured against. */
  locked_baselines: string[];
};

export type ProposedInitiative = {
  initiative_id: string;
  project: string;
  project_repo_path: string;
  title: string;
  iteration_budget: number;
  cost_budget_usd: number;
  /** Optional informational cost estimate surfaced in the aggregate footprint (C19). */
  estimated_cost_usd?: number;
  features: ProposedFeature[];
  /** Initiative-level dependencies on other initiatives (mirrors manifest.ts). */
  depends_on_initiatives?: string[];
  /** Raw manifest body — preserved verbatim in the PLAN.md drawer. */
  body: string;
  /** Set when this initiative is C27 `type: exploration`. */
  exploration?: ExplorationFields;
};

export type ProjectMetrics = {
  command: string[];
  baselines_dir: string;
  tolerance_pct?: number;
};

export type CouncilTranscript = {
  flags: Flag[];
  escalations: Escalation[];
  perCritic: { critic: string; verdict: CriticVerdict; costUsd: number }[];
  totalCostUsd: number;
};

export type BrainContextEntry = {
  /** Path under `brain/` that was consulted. */
  path: string;
  /** One-line summary of why this entry was relevant. */
  summary: string;
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
  /** Brain entries the architect consulted while drafting. */
  brain_context: BrainContextEntry[];
  /** Raw council output (flags / escalations / per-critic + total cost). */
  council: CouncilTranscript;
  /** One or more drafted initiatives — NOT yet written to `_queue/pending/`. */
  initiatives: ProposedInitiative[];
  /** C27 discriminator. Defaults to `implementation` when undefined. */
  type?: InitiativeType;
  /** C26: when the project has a `metrics` block in `.forge/project.json`. */
  project_metrics?: ProjectMetrics;
  /** Optional list of unresolved taste decisions the operator must settle. */
  open_escalations?: Escalation[];
};

export type Verdict = 'approve' | 'revise' | 'reject';

export type Annotation = {
  /** 1-based line number where the `<!-- review: ... -->` comment appeared. */
  line: number;
  text: string;
};

export type FeedbackParseResult = {
  verdict: Verdict | null;
  annotations: Annotation[];
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const VERDICT_PLACEHOLDER = '<!-- verdict: approve | revise | reject -->';

export function renderPlanDoc(session: ArchitectSession): string {
  const type: InitiativeType = session.type ?? 'implementation';
  const parts: string[] = [];

  // Operator-edited verdict marker — placed at the very top so a grep for
  // `<!-- verdict:` is trivially first-hit. Order matters: the operator
  // edits the inner text but should never need to scroll.
  parts.push(VERDICT_PLACEHOLDER);
  parts.push('');
  parts.push(`# Architect plan — ${session.session_id}`);
  parts.push('');
  parts.push(`- Project: \`${session.project}\``);
  parts.push(`- Repo: \`${session.project_repo_path}\``);
  parts.push(`- Initiative type: \`${type}\``);
  parts.push('');

  // Operator quick-start. We avoid an inline literal `<!-- review: ... -->`
  // here because the parser would mistake it for an annotation; we describe
  // the marker shape in prose instead. The template form of the verdict
  // marker IS shown verbatim at the top of the file — the parser ignores
  // it because the inner text is the placeholder `approve | revise | reject`
  // (none of the three concrete verdict tokens).
  parts.push(
    '> **Operator review.** Read each section. Leave inline notes by adding an HTML ' +
      'comment of the form `(left-angle bang dash dash review:` your text `dash dash right-angle)` on its own line beside any item. ' +
      'Set the verdict at the top of this file by replacing the placeholder with ' +
      '`approve`, `revise`, or `reject`. Then run ' +
      `\`forge architect commit ${session.session_id}\` (or pass \`--via-pr\` for PR-comment review).`,
  );
  parts.push('');

  // --- Vision recap ---
  parts.push('## Vision recap');
  parts.push('');
  parts.push(session.vision.trim());
  parts.push('');

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

  // --- Council transcript (aggregate flags + escalations, then one block per critic) ---
  parts.push('## Council transcript');
  parts.push('');
  parts.push(`Total cost: \`$${session.council.totalCostUsd.toFixed(4)}\``);
  parts.push('');

  // Aggregate flags (auto-applied across the council)
  if (session.council.flags.length > 0) {
    parts.push('### Flags (auto-applied)');
    parts.push('');
    for (const f of session.council.flags) {
      parts.push(`- \`${f.id}\` — ${f.description}. _Applied:_ ${f.appliedFix}`);
    }
    parts.push('');
  }

  // Aggregate escalations (de-duplicated across the council)
  if (session.council.escalations.length > 0) {
    parts.push('### Escalations (taste decisions surfaced)');
    parts.push('');
    for (const e of session.council.escalations) {
      parts.push(`- (${e.critic}) ${e.question}`);
      for (const o of e.options) {
        parts.push(`  - **${o.label}** — ${o.rationale}`);
      }
    }
    parts.push('');
  }

  for (const cr of session.council.perCritic) {
    parts.push(`### ${capitaliseCritic(cr.critic)} critic`);
    parts.push('');
    parts.push(`Cost: \`$${cr.costUsd.toFixed(4)}\``);
    parts.push('');
    if (cr.verdict.flags.length === 0) {
      parts.push('- _no mechanical flags_');
    } else {
      parts.push('**Flags (auto-resolved):**');
      parts.push('');
      for (const f of cr.verdict.flags) {
        parts.push(`- \`${f.id}\` — ${f.description}. _Applied:_ ${f.appliedFix}`);
      }
    }
    parts.push('');
    if (cr.verdict.escalations.length === 0) {
      parts.push('- _no taste escalations_');
    } else {
      parts.push('**Escalations (taste decisions):**');
      parts.push('');
      for (const e of cr.verdict.escalations) {
        parts.push(`- ${e.question}`);
        for (const o of e.options) {
          parts.push(`  - **${o.label}** — ${o.rationale}`);
        }
      }
    }
    parts.push('');
  }

  // --- Proposed initiatives ---
  parts.push('## Proposed initiatives');
  parts.push('');
  parts.push('| ID | Title | Features | Iteration budget | Depends on |');
  parts.push('|---|---|---|---|---|');
  for (const init of session.initiatives) {
    const dep = (init.depends_on_initiatives ?? []).join(', ') || '—';
    const budgetLabel = type === 'exploration'
      ? `${init.iteration_budget} (hint, not contract)`
      : String(init.iteration_budget);
    parts.push(
      `| \`${init.initiative_id}\` | ${init.title} | ${init.features.length} | ${budgetLabel} | ${dep} |`,
    );
  }
  parts.push('');

  // Per-initiative drawer with the full manifest body
  for (const init of session.initiatives) {
    parts.push(`### ${init.initiative_id} — drawer`);
    parts.push('');
    if (type === 'exploration' && init.exploration) {
      const ex = init.exploration;
      parts.push('**Exploration fields (C27):**');
      parts.push('');
      parts.push(`- iteration budget: ${init.iteration_budget} (hint, not contract — C27 L9)`);
      parts.push('- `parameter_space`:');
      parts.push('');
      for (const line of ex.parameter_space.split('\n')) {
        parts.push(`  ${line}`);
      }
      parts.push('');
      parts.push(`- \`hypothesis\`: ${ex.hypothesis}`);
      parts.push(`- \`metric_command\`: \`${ex.metric_command.join(' ')}\``);
      parts.push('- `locked_baselines`:');
      for (const b of ex.locked_baselines) {
        parts.push(`  - \`${b}\``);
      }
      parts.push('');
    }
    parts.push('```markdown');
    parts.push(init.body.trimEnd());
    parts.push('```');
    parts.push('');
  }

  // --- Project metrics (C26) ---
  if (session.project_metrics) {
    const m = session.project_metrics;
    parts.push('## Project metrics (per .forge/project.json)');
    parts.push('');
    parts.push(`- \`command\`: \`${m.command.join(' ')}\``);
    parts.push(`- \`baselines_dir\`: \`${m.baselines_dir}\``);
    if (typeof m.tolerance_pct === 'number') {
      parts.push(`- \`tolerance_pct\`: \`${m.tolerance_pct}\``);
    }
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
  if (type === 'exploration') {
    parts.push(
      '- _Note: this is an exploration initiative — iteration budgets are hints, not contracts (C27)._',
    );
  }
  parts.push('');

  // --- Open escalations (operator must resolve) ---
  const open = session.open_escalations ?? [];
  if (open.length > 0) {
    parts.push('## Open escalations');
    parts.push('');
    parts.push('_These taste decisions the council surfaced are unresolved. Resolve each inline ' +
      'with `<!-- review: ... -->` before approving, or explicitly defer in your verdict._');
    parts.push('');
    for (const e of open) {
      parts.push(`- (${e.critic}) ${e.question}`);
      for (const o of e.options) {
        parts.push(`  - **${o.label}** — ${o.rationale}`);
      }
    }
    parts.push('');
  }

  // --- Footer breadcrumb ---
  parts.push('---');
  parts.push('');
  parts.push(
    `_Generated by the architect skill on ${new Date().toISOString()}. ` +
      'Edit this file in place; commit with `forge architect commit ' +
      `${session.session_id}\`._`,
  );
  parts.push('');

  return parts.join('\n');
}

function capitaliseCritic(name: string): string {
  if (name === 'dx') return 'DX';
  if (name === 'ceo') return 'CEO';
  return name[0]?.toUpperCase() + name.slice(1);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write PLAN.md (+ council-transcript.md sibling) for a session.
 *
 * Returns the absolute path to the written `PLAN.md`. Creates the parent
 * directory as needed. C12: location is `<projectRoot>/_architect/<sid>/`.
 */
export function writePlanDoc(session: ArchitectSession, projectRoot: string): string {
  const sessionDir = resolve(projectRoot, '_architect', session.session_id);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const planPath = join(sessionDir, 'PLAN.md');
  writeFileSync(planPath, renderPlanDoc(session));
  // Write the raw council transcript as a sibling for auditability. This is
  // referenced by the PLAN.md drawer; keeping it separate keeps PLAN.md
  // human-readable and `council-transcript.md` machine-parseable later.
  const transcriptPath = join(sessionDir, 'council-transcript.md');
  writeFileSync(transcriptPath, renderCouncilTranscript(session));
  return planPath;
}

function renderCouncilTranscript(session: ArchitectSession): string {
  const lines: string[] = [];
  lines.push(`# Council transcript — ${session.session_id}`);
  lines.push('');
  lines.push(`Total cost: $${session.council.totalCostUsd.toFixed(4)}`);
  lines.push('');
  for (const cr of session.council.perCritic) {
    lines.push(`## ${capitaliseCritic(cr.critic)} (cost $${cr.costUsd.toFixed(4)})`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(cr.verdict, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const VERDICT_RE = /<!--\s*verdict:\s*(approve|revise|reject)\s*-->/i;
const REVIEW_RE = /<!--\s*review:\s*([\s\S]*?)\s*-->/i;

/**
 * Parse the operator-edited PLAN.md for the top-of-file verdict + inline
 * `<!-- review: ... -->` comments.
 *
 * - Verdict: first `<!-- verdict: approve|revise|reject -->` match wins;
 *   the literal placeholder `approve | revise | reject` (untouched template)
 *   is NOT a valid verdict — only one of the three concrete tokens counts.
 * - Annotations: every `<!-- review: ... -->` (one per line) gets recorded
 *   with its 1-based line number. Multi-line bodies are not supported.
 * - Annotations is always an array — never `null`.
 */
export function parseFeedbackComments(planDocPath: string): FeedbackParseResult {
  if (!existsSync(planDocPath)) {
    throw new Error(`parseFeedbackComments: file not found: ${planDocPath}`);
  }
  const text = readFileSync(planDocPath, 'utf8');
  const lines = text.split('\n');

  let verdict: Verdict | null = null;
  const annotations: Annotation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (verdict === null) {
      const m = VERDICT_RE.exec(line);
      if (m) {
        const v = m[1].toLowerCase();
        if (v === 'approve' || v === 'revise' || v === 'reject') {
          verdict = v;
        }
      }
    }
    const r = REVIEW_RE.exec(line);
    if (r) {
      annotations.push({ line: i + 1, text: r[1].trim() });
    }
  }

  return { verdict, annotations };
}

// ---------------------------------------------------------------------------
// Bundle feedback as markdown — fed back to the council on revise
// ---------------------------------------------------------------------------

export function bundleFeedbackAsMarkdown(annotations: Annotation[]): string {
  const lines: string[] = [];
  lines.push('# Operator feedback');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');
  if (annotations.length === 0) {
    lines.push('_The operator set a revise verdict but added no inline annotations. ' +
      'Treat the bare revise as a no-op and regenerate the same PLAN.md._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('The operator left these inline notes on PLAN.md:');
  lines.push('');
  for (const a of annotations) {
    lines.push(`- (line ${a.line}) ${a.text}`);
  }
  lines.push('');
  lines.push('Address each note in the next draft.');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Convenience: read the session dir layout (used by the CLI)
// ---------------------------------------------------------------------------

export type SessionPaths = {
  sessionDir: string;
  planPath: string;
  transcriptPath: string;
  feedbackPath: string;
  manifestsDir: string;
};

export function sessionPaths(projectRoot: string, sessionId: string): SessionPaths {
  const sessionDir = resolve(projectRoot, '_architect', sessionId);
  return {
    sessionDir,
    planPath: join(sessionDir, 'PLAN.md'),
    transcriptPath: join(sessionDir, 'council-transcript.md'),
    feedbackPath: join(sessionDir, 'feedback.md'),
    manifestsDir: join(sessionDir, 'manifests'),
  };
}

/**
 * Move a session dir to `_architect/_archived/<session-id>/`. Used by the
 * CLI on `reject`. Returns the archived path.
 */
export function archiveSessionDir(projectRoot: string, sessionId: string): string {
  const { sessionDir } = sessionPaths(projectRoot, sessionId);
  if (!existsSync(sessionDir)) {
    throw new Error(`archiveSessionDir: session dir not found: ${sessionDir}`);
  }
  const archivedRoot = resolve(projectRoot, '_architect', '_archived');
  if (!existsSync(archivedRoot)) mkdirSync(archivedRoot, { recursive: true });
  const target = join(archivedRoot, sessionId);
  // Use rename. node:fs renameSync requires same filesystem — within a
  // project repo that's always satisfied.
  if (existsSync(target)) {
    throw new Error(`archiveSessionDir: target already exists: ${target}`);
  }
  // Ensure parent of target exists (it does — we just created it).
  if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
  renameSync(sessionDir, target);
  return target;
}
