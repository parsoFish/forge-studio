'use client';

/**
 * ZoneWrap — label row + drop zone wrapper for the Agent Builder's
 * Capabilities & Constraints grid (skills/tools/mcps/guards/hooks).
 *
 * Extracted from app/agents/[id]/page.tsx (D12 file-size split, R2-09) — a
 * pure move, no behaviour change.
 */

import type { ReactNode } from 'react';

const ZONE_META: Record<string, { dotKind: string; label: string; hint: string }> = {
  skill: { dotKind: 'skill', label: 'Skills',       hint: 'what it knows how to do' },
  tool:  { dotKind: 'tool',  label: 'Tools & CLIs', hint: 'external processes it can invoke' },
  mcp:   { dotKind: 'mcp',   label: 'MCP Servers',  hint: 'structured data + action access' },
  guard: { dotKind: 'guard', label: 'Guards',        hint: 'dispatch keys, gates & observability' },
  hook:  { dotKind: 'hook',  label: 'Hooks',         hint: 'lifecycle scripts it carries' },
};

type Props = { kind: string; children: ReactNode };

export function ZoneWrap({ kind, children }: Props) {
  const meta = ZONE_META[kind];
  return (
    <div className="zone-wrap" data-component="zone-wrap">
      <div className="zone-label-row">
        <span className="zone-kind-dot" data-kind={meta.dotKind} />
        <span className="field-label" style={{ margin: 0 }}>{meta.label}</span>
        <span className="zone-label-hint">{meta.hint}</span>
      </div>
      {children}
    </div>
  );
}
