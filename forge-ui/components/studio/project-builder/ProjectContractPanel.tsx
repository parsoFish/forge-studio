import { fetchContractStages } from '@/lib/studio-client';
import type { ContractStageRow } from '@/lib/session-client';

// ---------------------------------------------------------------------------
// ProjectContractPanel (R4-12-F1) — the project page's read-only "contract
// buildout" panel. An ASYNC server component: it awaits its OWN GET
// `/api/studio/projects/:id/contract-stages` (via studio-client's
// `fetchContractStages`, the SAME `parseContractStageRow` boundary the
// session-shell's `contract-buildout` artifact runs) and returns fully-resolved
// markup. It is deliberately NOT a client component — a `useEffect`/`useState`
// fetch would never run under the repo's `renderToStaticMarkup` render harness,
// and sourcing the rows from a prop would not prove the panel owns its data.
//
// It mirrors ContractBuildout.tsx's checklist vocabulary exactly
// (`data-checklist-row` / `data-checklist-status` / `data-detail-line`) rather
// than reusing its component, because this panel renders each stage's detail
// lines INLINE under its checklist row (ContractBuildout's checklist mode does
// not) — one self-contained row block per stage.
//
// D3 (binding, security): the secrets stage's `detail` array is NAMES ONLY —
// the wire never carries a value, `parseContractStageRow` drops any extra
// value-shaped field, and this view renders each name plainly. It never invents
// a placeholder VALUE or mask (no "••••••", no "redacted") that could read as a
// partially-shown real value.
//
// D11 (binding): a row reports artifact PRESENCE ("present"/"absent"), never a
// clause verdict — this view renders exactly what the fetched row says.
//
// Honest degradation: absent stages render `data-checklist-status="absent"`; a
// missing north-star renders `data-contract-northstar-state="missing"`; the
// panel root always renders (a partial project never throws or blanks it).
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  contract: 'Contract',
  instructions: 'Instructions',
  secrets: 'Secrets',
  demo: 'Demo capability',
  roadmap: 'Roadmap',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

const HEADING_STYLE = {
  fontFamily: 'var(--font-display)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: 'var(--faint)',
  marginBottom: 8,
};

export async function ProjectContractPanel({
  projectId,
  northStar,
  instructions,
  instructionsSource,
}: {
  projectId: string;
  northStar?: string | null;
  instructions?: string | null;
  instructionsSource?: string | null;
}): Promise<JSX.Element> {
  // Own GET — exactly one, validated at the studio-client boundary. A missing
  // bridge / non-2xx / thrown fetch degrades to an empty checklist there, so
  // this await never rejects the render.
  const stages = await fetchContractStages(projectId);

  const ns = (northStar ?? '').trim();
  const nsState: 'present' | 'missing' = ns.length > 0 ? 'present' : 'missing';

  const conventions = instructions ?? '';
  const conventionsSource = instructionsSource ?? '';

  return (
    <section data-section="contract-panel" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={HEADING_STYLE}>Contract Buildout</div>
        <ContractChecklist rows={stages} />
      </div>

      <div>
        <div style={HEADING_STYLE}>North Star</div>
        <div
          data-contract-northstar=""
          data-contract-northstar-state={nsState}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            lineHeight: 1.45,
            color: nsState === 'present' ? 'var(--text)' : 'var(--faint)',
            fontStyle: nsState === 'present' ? 'normal' : 'italic',
            whiteSpace: 'pre-wrap',
          }}
        >
          {nsState === 'present' ? northStar : 'No north star set for this project.'}
        </div>
      </div>

      <div>
        <div style={HEADING_STYLE}>Conventions</div>
        <div
          data-contract-conventions-source={conventionsSource}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.5,
            color: conventions.length > 0 ? 'var(--text)' : 'var(--faint)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {conventions.length > 0 ? conventions : 'No conventions source bound.'}
        </div>
      </div>
    </section>
  );
}

function ContractChecklist({ rows }: { rows: ContractStageRow[] }): JSX.Element {
  return (
    <ul
      className="readiness-list"
      data-section="contract-checklist"
      data-checklist-row-count={rows.length}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {rows.map((row) => (
        <li
          key={row.stage}
          className={`readiness-item${row.status === 'present' ? ' ok' : ''}`}
          data-checklist-row={row.stage}
          data-checklist-status={row.status}
          title={row.source}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span
              className="ri-dot"
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                flexShrink: 0,
                background: row.status === 'present' ? 'var(--green)' : 'var(--amber)',
              }}
            />
            <strong>{stageLabel(row.stage)}</strong>
            <span style={{ color: 'var(--faint)', fontSize: 12 }}>{row.status}</span>
          </div>
          {row.detail.length > 0 && (
            <ul
              data-section="stage-detail-list"
              style={{ listStyle: 'none', margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              {row.detail.map((line) => (
                <li key={line} data-detail-line={line} style={{ fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
