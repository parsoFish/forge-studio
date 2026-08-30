'use client';

/**
 * StageSelector — W7-B5 (sessions-kinds-34): the multi-stage session shell
 * used to PUBLISH `data-session-selector-visible="true"` (and fully
 * unit-tested `selectStage`, lib/session-shell-view.ts) while rendering no
 * selector at all — 4 of the onboarding session's 5 stages were structurally
 * unreachable. This is the missing consumer: a segmented control over the
 * session's own declared `stages`, wired to `selectStage` by the page.
 *
 * DOM contract (docs/forge-ui-dom-and-harness.md → session shell):
 *   <nav data-component="stage-selector" role="tablist" aria-label="Session stages">
 *     one <button data-action="select-stage-<id>" data-stage=<id>
 *          role="tab" aria-selected data-active?  per declared stage,
 *          in the session's own declared order.
 *
 * forge-8vfn.5.6: every button used to declare the SAME `data-action`, and
 * `scripts/stories/beats.mjs`'s press verb resolves `[data-action=…]` and takes
 * `.first()` — so a beat could press "a stage" but never "the secrets stage",
 * and S1 beat 6 stood with no step rather than open whichever stage rendered
 * first and pretend it was secrets. The action now carries the instance, which
 * is Studio's own convention everywhere else (`browse-<name>`, `new-skill`).
 * `data-stage` stays: it is what the DOM contract reads.
 */

export type StageSelectorProps = {
  stages: readonly string[];
  selectedStage: string;
  onSelect: (stage: string) => void;
};

export function StageSelector({ stages, selectedStage, onSelect }: StageSelectorProps) {
  return (
    <nav
      data-component="stage-selector"
      role="tablist"
      aria-label="Session stages"
      style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}
    >
      {stages.map((stage) => {
        const active = stage === selectedStage;
        return (
          <button
            key={stage}
            type="button"
            role="tab"
            aria-selected={active}
            className={`seg-btn${active ? ' active' : ''}`}
            data-action={`select-stage-${stage}`}
            data-stage={stage}
            {...(active ? { 'data-active': 'true' } : {})}
            onClick={() => onSelect(stage)}
            style={{
              fontSize: 11.5,
              fontFamily: 'var(--font-mono)',
              padding: '3px 10px',
              borderRadius: 999,
              border: `1px solid ${active ? 'var(--accent, var(--text))' : 'var(--line-2)'}`,
              background: active ? 'var(--panel-2)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--dim)',
              cursor: 'pointer',
            }}
          >
            {stage}
          </button>
        );
      })}
    </nav>
  );
}
