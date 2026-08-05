'use client';

/**
 * ReadOnlyFields — SKILL.md-authored fields, not editable in M2 (phase +
 * allowed tool permissions).
 *
 * Extracted from app/agents/[id]/page.tsx (D12 file-size split, R2-09) — a
 * pure move, no behaviour change.
 */

type Props = {
  phase: string;
  allowedTools: string[];
  // A4: disallowed-tools are no longer surfaced — anything not allowed is
  // implicitly disallowed, so a separate list only added confusion.
};

export function ReadOnlyFields({ phase, allowedTools }: Props) {
  if (!phase && allowedTools.length === 0) return null;
  return (
    <div className="field-group" data-component="read-only-fields" style={{ opacity: 0.6 }}>
      <div className="field-label" style={{ marginBottom: 8 }}>
        SKILL.md fields (read-only — edit in skills/&lt;slug&gt;/SKILL.md)
      </div>
      {phase && (
        <div style={{ marginBottom: 8 }}>
          <span className="field-label" style={{ fontSize: 10 }}>Phase</span>
          <div className="readonly-field">
            <span className="readonly-token">{phase}</span>
          </div>
        </div>
      )}
      {allowedTools.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span className="field-label" style={{ fontSize: 10 }}>Tool permissions (Claude Code tools this agent may call)</span>
          <div className="readonly-field">
            {allowedTools.map((t) => <span key={t} className="readonly-token">{t}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
