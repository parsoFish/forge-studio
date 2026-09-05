/**
 * The architect PLAN.html renderer (cwc Amendment 2).
 *
 * Split out of `kinds/architect-plan.ts` (M4 exit row 5): that file wrote both
 * the markdown plan and the HTML one, and the HTML half is the larger and the
 * more self-contained of the two — it takes a session plus its initiatives and
 * returns a string, touching no fs and no session state.
 *
 * The seam is one-way at runtime: the parent calls `renderPlanHtml`, and the
 * only thing this module needs back from it is two TYPES, taken as
 * `import type` so nothing is imported at run time in that direction.
 */
import type { ArchitectSession, ProposedInitiative } from './architect-plan.ts';

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

  // Per-initiative card: AC list from body + body drawer
  function renderInitiativeCard(init: ProposedInitiative, idx: number): string {
    const hue = (idx * 67) % 360;
    const dep = (init.depends_on_initiatives ?? []).join(', ') || '—';
    // ADR 051: the criteria are DECLARED on the initiative, not recovered from
    // its prose. What was `extractGwtBlocks(init.body)` — four regex shapes
    // accreted from four real runs, each addition made after a run produced
    // something the parser did not expect, and every miss a silent absence.
    const gwtBlocks = init.acceptance_criteria;
    // A clause can be genuinely absent from the source AC (Given+Then, no
    // When — WI-7a constraint 2). Render that honestly as an em-dash rather
    // than an empty cell (which reads as a rendering bug) or fabricated text.
    const cell = (clauseText: string): string => (clauseText.length > 0 ? esc(clauseText) : '—');
    const acRows = gwtBlocks.length > 0
      ? gwtBlocks.map((b, i) =>
          `<tr><td>${i + 1}</td><td>${cell(b.given)}</td><td>${cell(b.when)}</td><td>${cell(b.then)}</td></tr>`
        ).join('\n')
      : `<tr><td colspan="4" class="empty">This initiative declares no acceptance criteria.</td></tr>`;
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
    </div>
  </div>

  <div class="notice">
    <strong>Read-only viewer.</strong> Review at
    <code>/artifact?run=_architect-${esc(session.session_id)}&amp;type=plan</code> in Forge Studio —
    approve, revise, or reject there.
  </div>

  <!-- ── 2. INITIATIVE CARDS ── -->
  <h2>Proposed initiatives</h2>
  <div class="init-cards">
${session.initiatives.map((init, idx) => renderInitiativeCard(init, idx)).join('\n')}
  </div>

  <!-- ── EDGE CASES & CONSTRAINTS (R4-04-F4) ── -->
  ${session.explore && (session.explore.edgeCases.length > 0 || session.explore.brainConstraints.length > 0)
    ? `<h2>Edge cases &amp; constraints</h2>
  ${session.explore.exploreSummary ? `<p>${esc(session.explore.exploreSummary)}</p>` : ''}
  <ul class="brain-list">
${session.explore.edgeCases.map((ec) => `    <li><strong>[${esc(ec.disposition)}]</strong> ${esc(ec.title)} — ${esc(ec.detail)}</li>`).join('\n')}
${session.explore.brainConstraints.map((bc) => `    <li><em>constraint:</em> ${esc(bc.constraint)} <code>${esc(bc.source)}</code></li>`).join('\n')}
  </ul>`
    : ''}

  <!-- ── 3. BRAIN CONTEXT ── -->
  <h2>Brain context</h2>
  ${session.brain_context.length === 0
    ? '<p class="empty">No brain entries consulted (brain-gap event emitted).</p>'
    : `<ul class="brain-list">
${session.brain_context.map((e) => `    <li><code>${esc(e.path)}</code> — ${esc(e.summary)}</li>`).join('\n')}
  </ul>`}

  <!-- ── 4. AGGREGATE FOOTPRINT (C19 informational) ── -->
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

  <!-- ── 5. OPERATOR BRIEF + INTERVIEW ── -->
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
    Reviewed + approved at <code>/artifact?run=_architect-${esc(session.session_id)}&amp;type=plan</code> in Forge Studio.
  </div>
</body>
</html>
`;
}
