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
 *  - `writePlanDoc(session, root)`      — returns PLAN.md path (also writes PLAN.html + council-transcript.md)
 *
 * The PLAN is reviewed + approved on the in-UI `/architect/<sid>` plan gate
 * (ADR 020/023); the operator's verdict comes through the bridge, not via
 * PLAN.md annotations.
 */

import { writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Flag, Escalation, CriticVerdict, OptionVisual } from '../skills/architect-llm-council/council.ts';

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
  /** One or more drafted initiatives — NOT yet written to `_queue/pending/`. */
  initiatives: ProposedInitiative[];
  /** Optional list of unresolved taste decisions the operator must settle. */
  open_escalations?: Escalation[];
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

  // Operator quick-start — the plan is reviewed + approved on the in-UI plan gate.
  parts.push(
    '> **Operator review.** This plan is presented on the `/architect/' + session.session_id +
      '` screen in the forge UI. Read each section there, resolve the council\'s design ' +
      'decisions, and click **approve**, **revise**, or **reject** — the runner finalizes ' +
      'your verdict, promoting the manifests to the queue only on approve.',
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

  // --- Open escalations (operator must resolve on the /architect gate) ---
  const open = session.open_escalations ?? [];
  if (open.length > 0) {
    parts.push('## Open escalations');
    parts.push('');
    parts.push('_These taste decisions the council surfaced are unresolved. Resolve each ' +
      'on the `/architect` plan gate — your selection is applied at approval._');
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
    `_Generated by the architect runner on ${new Date().toISOString()}. ` +
      'Reviewed + approved on the `/architect` screen in the forge UI._',
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
// HTML render (cwc Amendment 2)
// ---------------------------------------------------------------------------

/**
 * HTML-escape a string. Used for any session-derived content interpolated
 * into the PLAN.html template — the manifest bodies, vision text, interview
 * answers, council flags etc all flow through this.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Phase C — render an option's visual (mockup / diagram / code) for the
 * comparative panel. `mockup-html` goes in a sandboxed iframe (no scripts, no
 * same-origin); diagram/code render as preformatted text to stay zero-dep.
 */
function renderOptionVisual(v?: OptionVisual): string {
  if (!v || v.kind === 'none' || !v.content) return '';
  const cap = v.caption ? `<div class="cap">${esc(v.caption)}</div>` : '';
  if (v.kind === 'mockup-html') {
    return `<div class="opt-visual"><iframe class="mockup" sandbox="" title="mockup" srcdoc="${esc(v.content)}"></iframe>${cap}</div>`;
  }
  if (v.kind === 'code') {
    const lang = v.language ? ` data-lang="${esc(v.language)}"` : '';
    return `<div class="opt-visual"><pre class="code"${lang}><code>${esc(v.content)}</code></pre>${cap}</div>`;
  }
  return `<div class="opt-visual"><pre class="diagram">${esc(v.content)}</pre>${cap}</div>`;
}

function renderTradeoffs(t?: { pros?: string[]; cons?: string[] }): string {
  const pros = t?.pros ?? [];
  const cons = t?.cons ?? [];
  if (pros.length === 0 && cons.length === 0) return '';
  return `<ul class="tradeoffs">${pros.map((p) => `<li class="pro">${esc(p)}</li>`).join('')}${cons.map((c) => `<li class="con">${esc(c)}</li>`).join('')}</ul>`;
}

/**
 * Phase C — one escalated decision as a READ-ONLY comparative panel: the
 * question + its 2-4 options side by side, each card showing rationale,
 * tradeoffs, and the option's visual. Resolution happens on the `/architect`
 * plan-gate cards (the single interactive surface — operator pref 2026-06-01);
 * this preview deliberately has NO radio input. `data-*` mirrors the
 * decision/option identity for automation.
 */
function renderEscalationCard(e: Escalation, i: number): string {
  const opts = e.options
    .map(
      (o) => `      <div class="option" data-option-label="${esc(o.label)}" data-option-visual-kind="${esc(o.visual?.kind ?? 'none')}">
        <div class="opt-head"><span class="label">${esc(o.label)}</span></div>
        <div class="rationale">${esc(o.rationale)}</div>
        ${renderTradeoffs(o.tradeoffs)}
        ${renderOptionVisual(o.visual)}
      </div>`,
    )
    .join('\n');
  return `    <div class="escalation" data-decision="${i}" data-escalation-id="esc-${i}" data-escalation-question="${esc(e.question)}">
      <div class="q"><span class="critic-chip">${esc(e.critic)}</span>${esc(e.question)}</div>
      <div class="options">
${opts}
      </div>
    </div>`;
}

/**
 * Extract GWT blocks from a markdown body. Returns an array of objects with
 * given/when/then strings, parsed from fenced YAML blocks or from inline
 * bullet-list style. Falls back to a flat display of lines matching GWT
 * keywords if no structured blocks are found.
 */
function extractGwtBlocks(body: string): Array<{ given: string; when: string; then: string }> {
  const blocks: Array<{ given: string; when: string; then: string }> = [];
  // Match YAML-style GWT entries: lines starting with given:/when:/then:
  const lines = body.split('\n');
  let cur: Partial<{ given: string; when: string; then: string }> = {};
  for (const line of lines) {
    const gm = /^\s*-?\s*given:\s*["']?(.*?)["']?\s*$/.exec(line);
    const wm = /^\s*when:\s*["']?(.*?)["']?\s*$/.exec(line);
    const tm = /^\s*then:\s*["']?(.*?)["']?\s*$/.exec(line);
    if (gm) {
      if (cur.given && cur.when && cur.then) blocks.push(cur as { given: string; when: string; then: string });
      cur = { given: gm[1]?.trim() ?? '' };
    } else if (wm && cur.given) {
      cur.when = wm[1]?.trim() ?? '';
    } else if (tm && cur.given) {
      cur.then = tm[1]?.trim() ?? '';
    }
  }
  if (cur.given && cur.when && cur.then) blocks.push(cur as { given: string; when: string; then: string });
  return blocks;
}

/**
 * D3 — Render a self-contained, genuinely rich HTML viewer for the architect
 * session. Zero external deps — single HTML file, inline CSS. The operator
 * opens this in their browser; it is read-only (verdict on the /architect
 * plan-gate screen). Sections over paragraphs; cards not prose; empty
 * sections collapsed.
 *
 * Structure (top-to-bottom):
 *  1. Header — vision + initiative count + session metadata
 *  2. Per-initiative CARDS — title, budget, depends-on, AC list from body,
 *     manifest body drawer
 *  3. Design decisions — COMPARATIVE CARDS side by side (pros/cons + visuals)
 *  4. Brain context — what the architect consulted
 *  5. Council transcript — per-critic accordion (collapsed)
 *  6. Aggregate footprint — stacked bar (C19 informational)
 *  7. Operator brief + interview table
 */
export function renderPlanHtml(session: ArchitectSession): string {
  const rounds = session.interview ?? [];
  const totalIterations = session.initiatives.reduce((s, i) => s + i.iteration_budget, 0);
  const knownCost = session.initiatives.filter((i) => typeof i.estimated_cost_usd === 'number');
  const totalEstimated = knownCost.reduce((s, i) => s + (i.estimated_cost_usd ?? 0), 0);
  const open = session.open_escalations ?? [];

  // Per-initiative card: AC list from body + body drawer
  function renderInitiativeCard(init: ProposedInitiative, idx: number): string {
    const hue = (idx * 67) % 360;
    const dep = (init.depends_on_initiatives ?? []).join(', ') || '—';
    const gwtBlocks = extractGwtBlocks(init.body);
    const acRows = gwtBlocks.length > 0
      ? gwtBlocks.map((b, i) =>
          `<tr><td>${i + 1}</td><td>${esc(b.given)}</td><td>${esc(b.when)}</td><td>${esc(b.then)}</td></tr>`
        ).join('\n')
      : `<tr><td colspan="4" class="empty">No GWT blocks parsed — see manifest body below.</td></tr>`;
    return `<div class="init-card" data-initiative-id="${esc(init.initiative_id)}" style="--card-accent: hsl(${hue}, 55%, 50%)">
  <div class="init-header">
    <div class="init-title-block">
      <span class="init-id badge">${esc(init.initiative_id)}</span>
      <span class="init-title">${esc(init.title)}</span>
    </div>
    <div class="init-chips">
      <span class="chip">budget <strong>${init.iteration_budget}</strong></span>
      ${typeof init.cost_budget_usd === 'number' ? `<span class="chip">cap <strong>$${init.cost_budget_usd}</strong></span>` : ''}
      ${dep !== '—' ? `<span class="chip dep-chip">after ${esc(dep)}</span>` : ''}
    </div>
  </div>
  <div class="ac-list-wrap">
    <div class="ac-list-title">Acceptance criteria</div>
    <table class="ac-table">
      <thead><tr><th>#</th><th>Given</th><th>When</th><th>Then</th></tr></thead>
      <tbody>${acRows}</tbody>
    </table>
  </div>
  <details class="body-drawer">
    <summary>Manifest body</summary>
    <pre>${esc(init.body.trimEnd())}</pre>
  </details>
</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PLAN — ${esc(session.session_id)} — ${esc(session.project)}</title>
<style>
  /* Unified with the forge-ui dark stage. Dark-only (the app has no light mode). */
  :root {
    --bg: #0a0e14;
    --fg: #e6edf3;
    --muted: #8b949e;
    --border: #21262d;
    --accent: #1f6feb;
    --user: #2ea043;
    --warn: #d29922;
    --code-bg: #0a0f16;
    --card-bg: #11161d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.5rem 4rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.55;
    max-width: 1180px;
    margin-left: auto;
    margin-right: auto;
  }
  /* ── Typography ── */
  h1 { font-size: 1.75rem; margin: 0 0 0.2rem; letter-spacing: -0.01em; }
  h2 { font-size: 1.1rem; margin: 2.25rem 0 0.75rem; letter-spacing: -0.005em;
       text-transform: uppercase; color: var(--muted); font-weight: 600; letter-spacing: 0.06em; font-size: 0.72rem; }
  h3 { font-size: 0.95rem; margin: 1rem 0 0.4rem; }
  p { margin: 0.5rem 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; }
  pre {
    background: var(--code-bg);
    padding: 0.75rem 1rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.79rem;
    line-height: 1.45;
    margin: 0;
  }
  ul, ol { padding-left: 1.5rem; margin: 0.4rem 0; }
  /* ── Badges & chips ── */
  .badge {
    display: inline-block;
    background: var(--code-bg);
    color: var(--muted);
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  }
  .chip {
    display: inline-block;
    background: var(--card-bg);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
  }
  .chip strong { color: var(--fg); }
  .dep-chip { border-color: var(--warn); color: var(--warn); }
  /* ── Notice ── */
  .notice {
    background: var(--card-bg);
    border-left: 3px solid var(--accent);
    padding: 0.65rem 1rem;
    margin: 0.75rem 0 1.5rem;
    border-radius: 3px;
    font-size: 0.88rem;
  }
  /* ── Plan header ── */
  .plan-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 1.5rem;
    margin-bottom: 1rem;
  }
  .plan-header .vision-block { flex: 1 1 55%; min-width: 260px; }
  .plan-header .stats-block {
    flex: 0 0 auto;
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .stat-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.6rem 1rem;
    text-align: center;
    min-width: 80px;
  }
  .stat-card .num { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
  .stat-card .lbl { font-size: 0.68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.2rem; }
  .plan-meta { font-size: 0.8rem; color: var(--muted); margin-top: 0.6rem; }
  .plan-meta code { background: var(--code-bg); padding: 0.1rem 0.3rem; border-radius: 3px; }
  /* ── Initiative cards ── */
  .init-cards { display: grid; gap: 1.25rem; }
  .init-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-top: 3px solid var(--card-accent, var(--accent));
    border-radius: 6px;
    padding: 1rem 1.15rem 0.75rem;
  }
  .init-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .init-title-block { display: flex; flex-direction: column; gap: 0.25rem; }
  .init-title { font-size: 1.05rem; font-weight: 600; }
  .init-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; padding-top: 0.1rem; }
  /* ── AC list ── */
  .ac-list-wrap {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem;
    margin: 0.5rem 0 0.85rem;
    overflow-x: auto;
  }
  .ac-list-title { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
  /* ── AC table ── */
  .ac-table { width: 100%; border-collapse: collapse; margin: 0 0 0.75rem; font-size: 0.83rem; }
  .ac-table th { font-weight: 600; color: var(--muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.3rem 0.65rem; border-bottom: 1px solid var(--border); text-align: left; }
  .ac-table td { padding: 0.35rem 0.65rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  /* ── Tables (general) ── */
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; }
  th, td { padding: 0.45rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 0.88rem; }
  th { font-weight: 600; color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
  /* ── Body drawer ── */
  .body-drawer {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.4rem 0.75rem;
  }
  .body-drawer summary { cursor: pointer; font-size: 0.82rem; color: var(--muted); padding: 0.2rem 0; }
  .body-drawer[open] summary { margin-bottom: 0.5rem; }
  /* ── Design decision cards ── */
  .decisions { display: grid; gap: 1.25rem; }
  .escalation {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem;
  }
  .escalation .q { font-weight: 600; margin-bottom: 0.65rem; font-size: 0.95rem; }
  .escalation .critic-chip {
    display: inline-block;
    font-size: 0.67rem;
    background: var(--accent);
    color: white;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    margin-right: 0.45rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .escalation .options {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 0.75rem;
    align-items: stretch;
  }
  .escalation .option {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem 0.9rem;
    font-size: 0.83rem;
  }
  .escalation .option .opt-head { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; }
  .escalation .option .label { font-weight: 700; font-size: 0.88rem; }
  .escalation .option .rationale { color: var(--muted); font-size: 0.82rem; }
  .escalation .option .tradeoffs { list-style: none; padding: 0; margin: 0.55rem 0 0; font-size: 0.77rem; display: grid; gap: 0.15rem; }
  .escalation .option .tradeoffs .pro::before { content: '✓'; color: #2ea043; margin-right: 0.3rem; }
  .escalation .option .tradeoffs .con::before { content: '✕'; color: #cf222e; margin-right: 0.3rem; }
  .escalation .option .opt-visual { margin-top: 0.6rem; }
  .escalation .option .opt-visual iframe.mockup { width: 100%; height: 168px; border: 1px solid var(--border); border-radius: 5px; background: #0d1117; display: block; }
  .escalation .option .opt-visual pre.code,
  .escalation .option .opt-visual pre.diagram {
    background: var(--card-bg); border: 1px solid var(--border); border-radius: 5px;
    padding: 0.55rem 0.65rem; font-size: 0.72rem; line-height: 1.4; overflow: auto; max-height: 190px; margin: 0;
  }
  .escalation .option .opt-visual .cap { color: var(--muted); font-size: 0.7rem; font-style: italic; margin-top: 0.3rem; }
  /* ── Council accordions ── */
  details.council-critic {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.9rem;
    margin: 0.4rem 0;
  }
  details.council-critic summary { cursor: pointer; font-weight: 500; font-size: 0.88rem; padding: 0.25rem 0; }
  details.council-critic[open] summary { margin-bottom: 0.5rem; }
  /* ── Brain context ── */
  .brain-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.3rem; }
  .brain-list li { background: var(--card-bg); border: 1px solid var(--border); border-left: 3px solid #d2a8ff; border-radius: 4px; padding: 0.35rem 0.75rem; font-size: 0.83rem; }
  .brain-list li code { color: #d2a8ff; }
  /* ── Footprint bar ── */
  .footprint { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; }
  .footprint .bar { display: flex; width: 100%; height: 1.5rem; border-radius: 3px; overflow: hidden; margin: 0.5rem 0; background: var(--code-bg); }
  .footprint .seg { display: flex; align-items: center; justify-content: center; color: white; font-size: 0.7rem; font-weight: 500; text-shadow: 0 0 2px rgba(0,0,0,.5); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 0.25rem; }
  .footprint .summary { color: var(--muted); font-size: 0.83rem; margin-top: 0.25rem; }
  .footprint .info { color: var(--muted); font-size: 0.78rem; font-style: italic; margin-top: 0.45rem; }
  /* ── Misc ── */
  .empty { color: var(--muted); font-style: italic; }
  hr { border: none; border-top: 1px solid var(--border); margin: 2.5rem 0 1.25rem; }
  .footer { color: var(--muted); font-size: 0.78rem; }
  .footer code { background: var(--code-bg); padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
</head>
<body>

  <!-- ── 1. HEADER ── -->
  <div class="plan-header">
    <div class="vision-block">
      <h1>Architect plan</h1>
      <p style="color: var(--fg); font-size: 1rem; margin: 0.35rem 0 0.6rem; line-height: 1.5">${esc(session.vision.trim()).replace(/\n+/g, '</p><p style="color: var(--fg); font-size: 1rem; margin: 0.35rem 0 0.6rem; line-height: 1.5">')}</p>
      <div class="plan-meta">
        Session <code>${esc(session.session_id)}</code>
        · Project <code>${esc(session.project)}</code>
        · Repo <code>${esc(session.project_repo_path)}</code>
      </div>
    </div>
    <div class="stats-block">
      <div class="stat-card"><div class="num">${session.initiatives.length}</div><div class="lbl">initiative${session.initiatives.length === 1 ? '' : 's'}</div></div>
      <div class="stat-card"><div class="num">${totalIterations}</div><div class="lbl">total budget</div></div>
      ${knownCost.length === session.initiatives.length && session.initiatives.length > 0
        ? `<div class="stat-card"><div class="num">$${totalEstimated.toFixed(0)}</div><div class="lbl">est. cost</div></div>`
        : ''}
      ${open.length > 0 ? `<div class="stat-card" style="border-color: var(--warn)"><div class="num" style="color: var(--warn)">${open.length}</div><div class="lbl">decisions</div></div>` : ''}
    </div>
  </div>

  <div class="notice">
    <strong>Read-only viewer.</strong> Review on the
    <code>/architect/${esc(session.session_id)}</code> screen in the forge UI —
    approve, revise, or reject there. Your selections on design decisions are
    applied at approval.
  </div>

  <!-- ── 2. INITIATIVE CARDS ── -->
  <h2>Proposed initiatives</h2>
  <div class="init-cards">
${session.initiatives.map((init, idx) => renderInitiativeCard(init, idx)).join('\n')}
  </div>

  <!-- ── 3. DESIGN DECISIONS (comparative cards) ── -->
  ${open.length === 0 ? '' : `
  <h2>Design decisions <span class="badge">${open.length} unresolved</span></h2>
  <p style="color: var(--muted); font-size: 0.83rem; margin-bottom: 0.85rem">
    The council surfaced the following taste decisions. Options are shown side-by-side
    with pros/cons and visual mockups where available. Resolve each one on the
    <code>/architect</code> plan gate; your selection is applied at approval.
  </p>
  <div class="decisions" data-section="design-decisions-preview" data-readonly="true" data-decision-count="${open.length}">
${open.map((e, i) => renderEscalationCard(e, i)).join('\n')}
  </div>`}

  <!-- ── 4. BRAIN CONTEXT ── -->
  <h2>Brain context</h2>
  ${session.brain_context.length === 0
    ? '<p class="empty">No brain entries consulted (brain-gap event emitted).</p>'
    : `<ul class="brain-list">
${session.brain_context.map((e) => `    <li><code>${esc(e.path)}</code> — ${esc(e.summary)}</li>`).join('\n')}
  </ul>`}

  <!-- ── 5. COUNCIL TRANSCRIPT (collapsed) ── -->
  <h2>Council transcript</h2>
  <p style="color: var(--muted); font-size: 0.83rem; margin-bottom: 0.6rem">Total cost <code>$${session.council.totalCostUsd.toFixed(4)}</code></p>
  ${session.council.perCritic.map((cr) => `
  <details class="council-critic">
    <summary>${esc(capitaliseCritic(cr.critic))} critic — <code>$${cr.costUsd.toFixed(4)}</code></summary>
    ${cr.verdict.flags.length === 0
      ? '<p class="empty">No mechanical flags.</p>'
      : `<h3>Flags (auto-resolved)</h3><ul>${cr.verdict.flags.map((f) => `<li><code>${esc(f.id)}</code> — ${esc(f.description)}. <em>Applied:</em> ${esc(f.appliedFix)}</li>`).join('')}</ul>`}
    ${cr.verdict.escalations.length === 0
      ? '<p class="empty">No taste escalations.</p>'
      : `<h3>Escalations</h3><div class="decisions">${cr.verdict.escalations.map((e) => `<div class="escalation"><div class="q">${esc(e.question)}</div><div class="options">${e.options.map((o) => `<div class="option"><div class="opt-head"><span class="label">${esc(o.label)}</span></div><div class="rationale">${esc(o.rationale)}</div></div>`).join('')}</div></div>`).join('')}</div>`}
  </details>`).join('')}

  <!-- ── 6. AGGREGATE FOOTPRINT (C19 informational) ── -->
  <h2>Aggregate footprint <span class="badge">informational</span></h2>
  <div class="footprint">
    <div class="summary">${session.initiatives.length} initiative${session.initiatives.length === 1 ? '' : 's'} · total iteration budget <strong>${totalIterations}</strong>${knownCost.length === session.initiatives.length && session.initiatives.length > 0 ? ` · total estimated cost <strong>$${totalEstimated.toFixed(2)}</strong>` : knownCost.length > 0 ? ` · partial estimated cost <strong>$${totalEstimated.toFixed(2)}</strong> (${knownCost.length}/${session.initiatives.length} have estimates)` : ''}</div>
    <div class="bar" role="img" aria-label="Iteration budget split across proposed initiatives">
${session.initiatives.map((i, idx) => {
      const pct = totalIterations > 0 ? (i.iteration_budget / totalIterations) * 100 : 0;
      const hue = (idx * 67) % 360;
      return `      <div class="seg" style="flex: ${i.iteration_budget}; background: hsl(${hue}, 55%, 50%);" title="${esc(i.initiative_id)} — ${i.iteration_budget} iterations">${pct >= 8 ? esc(i.initiative_id.replace(/^INIT-\d{4}-\d{2}-\d{2}-/, '')) : ''}</div>`;
    }).join('\n')}
    </div>
    <div class="info">Informational only. Forge does not enforce a budget or block at any number; the operator decides.</div>
  </div>

  <!-- ── 7. OPERATOR BRIEF + INTERVIEW ── -->
  <h2>Operator brief + interview</h2>
  ${rounds.length === 0
    ? '<p class="empty">No interview rounds — operator drafted directly.</p>'
    : `<table>
    <thead><tr><th>#</th><th>Question</th><th>Operator answer</th></tr></thead>
    <tbody>
${rounds.map((r, i) => `      <tr><td>${i + 1}</td><td>${esc(r.question)}</td><td>${esc(r.answer)}</td></tr>`).join('\n')}
    </tbody>
  </table>`}

  <hr>
  <div class="footer">
    Generated by the architect runner on ${new Date().toISOString()}.
    Reviewed + approved on the <code>/architect/${esc(session.session_id)}</code> screen.
  </div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write PLAN.md (+ sibling PLAN.html + sibling council-transcript.md) for a
 * session. Returns the absolute path to the written `PLAN.md`. Creates the
 * parent directory as needed. C12: location is `<projectRoot>/_architect/<sid>/`.
 *
 * Three artefacts per session:
 *  - `PLAN.md`               — operator's annotation surface (parsed by the CLI)
 *  - `PLAN.html`             — read-only rich viewer (cwc Amendment 2)
 *  - `council-transcript.md` — raw council output, audit / machine-parse
 */
export function writePlanDoc(session: ArchitectSession, projectRoot: string): string {
  const sessionDir = resolve(projectRoot, '_architect', session.session_id);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const planPath = join(sessionDir, 'PLAN.md');
  writeFileSync(planPath, renderPlanDoc(session));
  // Sibling rich viewer (cwc Amendment 2). Operator opens in browser; never
  // read back as input — PLAN.md is the only parse target.
  const htmlPath = join(sessionDir, 'PLAN.html');
  writeFileSync(htmlPath, renderPlanHtml(session));
  // Raw council transcript for auditability — referenced by PLAN.md's drawer
  // but kept separate so PLAN.md stays human-readable and the transcript
  // stays machine-parseable.
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
