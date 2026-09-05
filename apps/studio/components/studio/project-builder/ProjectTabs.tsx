'use client';

/**
 * The project page's two-tab bar, extracted from `app/projects/[id]/page.tsx`
 * so its buttons can DECLARE the act they perform (bead `forge-8vfn.6.11.9`,
 * operator ruling 212 as re-scoped by T1 ruling 215).
 *
 * THE DEFECT THIS CLOSES. The buttons carried `data-tab` and `data-tab-active`
 * — qualifiers, not acts — and no `data-action` at all.
 * `scripts/stories/beats.mjs` resolves `[data-field=…]` and `[data-action=…]`
 * only, so no story could switch this page to its roadmap tab; and
 * `plan-with-architect` lives inside `ProjectArchitectEntry`, which renders in
 * EVERY branch of `[data-section="project-roadmap"]`. S1 beat 10 therefore read
 * "no element carries that handle" for a handle that is unconditionally
 * rendered — one tab away. Same class as `forge-8vfn.6.11.3`'s `+ Add step`:
 * the one control on a surface outside the declared contract, found only when a
 * story finally reached it.
 *
 * The `data-action` sits BESIDE the qualifiers rather than replacing them —
 * #430's picker shape — so `data-tab`/`data-tab-active` readers are untouched
 * and no journey changes.
 */

export type ProjectTab = 'editor' | 'roadmap';

export const PROJECT_TABS: readonly ProjectTab[] = ['editor', 'roadmap'];

export function ProjectTabs({
  tab,
  onSelect,
}: {
  tab: ProjectTab;
  onSelect: (t: ProjectTab) => void;
}): JSX.Element {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2,
      padding: '0 28px',
      borderBottom: '1px solid var(--line)',
      background: 'var(--bg-2)',
    }}>
      {PROJECT_TABS.map((t) => (
        <button
          key={t}
          data-tab={t}
          data-tab-active={tab === t ? 'true' : 'false'}
          data-action={`project-tab-${t}`}
          onClick={() => onSelect(t)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
            color: tab === t ? 'var(--text)' : 'var(--faint)',
            padding: '10px 14px 8px',
            borderBottom: tab === t ? '2px solid var(--c-project)' : '2px solid transparent',
            textTransform: 'capitalize',
          }}
        >
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );
}
