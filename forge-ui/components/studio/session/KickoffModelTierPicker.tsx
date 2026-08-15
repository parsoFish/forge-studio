'use client';

import type { AgentCapability, ModelTier } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// KickoffModelTierPicker (W6-B6 fix — wave-6 final gate, journey
// demo-builder DB-4).
//
// Extracted from the generic session-kickoff page
// (app/sessions/[kind]/new/page.tsx) so its two render states — a real
// `role="radiogroup"` for a `strategy:range` agent, a read-only chip
// otherwise — are directly unit-testable via `renderToStaticMarkup`
// (mirrors SessionInteractivePanel.test.ts's own pattern), independent of
// the kickoff page's data-fetching plumbing.
//
// `capability` is the UNFILTERED per-slug descriptor the kickoff page fetches
// via `fetchAgentCapability(agentSlug)` (`GET
// /api/studio/agents/:slug/capability`) — NEVER the filtered
// `/api/studio/agents` roster, which drops every `library:false` kickoff-only
// agent (demo-builder, instructions-creator, brain-maintenance,
// creation-agent, project-brain-builder) entirely. Before this fix the
// kickoff page derived its picker from that filtered roster, so all five
// agents above always rendered the read-only 'fixed' chip — even after B5
// widened their SKILL.mds to `strategy: range`. `capability === null`
// (not yet loaded, or an unknown slug) renders the SAME read-only chip as a
// genuine `strategy:fixed` agent — an honest "no operator-choosable tier
// right now" state, never a fabricated range.
// ---------------------------------------------------------------------------

/** The real, non-empty tier envelope for a `strategy:range` agent — `[]` for
 *  `strategy:fixed`, an absent/not-yet-loaded/unknown-slug `capability`
 *  alike. Exported so the kickoff page can derive the SAME `isRangeTier`
 *  condition for its `onSubmit` tier-resolution logic without a second,
 *  independently-computed copy of this rule. */
export function allowedTiersFromCapability(capability: AgentCapability | null | undefined): ModelTier[] {
  return capability && Array.isArray(capability.allowedTiers) && capability.allowedTiers.length > 0
    ? capability.allowedTiers
    : [];
}

export type KickoffModelTierPickerProps = {
  capability: AgentCapability | null;
  modelTier: string;
  onChange: (tier: ModelTier) => void;
};

export function KickoffModelTierPicker({ capability, modelTier, onChange }: KickoffModelTierPickerProps): JSX.Element {
  const allowedTiers = allowedTiersFromCapability(capability);
  const isRangeTier = allowedTiers.length > 0;

  return (
    <div data-section="kickoff-model-tier" data-model-tier-picker={isRangeTier ? 'range' : 'fixed'} style={{ ...cardStyle, marginBottom: 14 }}>
      <div style={rowLabel}>Model</div>
      {isRangeTier ? (
        <div role="radiogroup" aria-label="Model tier" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {allowedTiers.map((t) => (
            <label key={t} data-field="kickoff-model-tier-option" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text)' }}>
              <input type="radio" name="modelTier" value={t} checked={modelTier === t} onChange={() => onChange(t)} />
              {t}
            </label>
          ))}
        </div>
      ) : (
        <div data-field="kickoff-model-fixed-chip" style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          fixed · read-only
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--bg-2)', maxWidth: 560,
};
const rowLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 };
