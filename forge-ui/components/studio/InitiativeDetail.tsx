'use client';

/**
 * InitiativeDetail — the R4-13 roadmap DAG node's detail body, extracted from
 * `RoadmapNode` (RoadmapDag.tsx) as a PURE re-home (W6-RV-1, the
 * direction-agnostic first step toward the time-axis canvas, RV-2). Every
 * data-* attribute and the surrounding DOM shape are byte-identical to the
 * markup this replaces — see `lib/roadmap-dag-render.test.ts` (the AT4/AT5
 * cases plus the W6-RV-1 collapsed-card/badge-arithmetic block) for the pin;
 * there is no separate `initiative-detail-render.test.ts` file.
 *
 * Deps line, blocked/blocked-until-planned locks, WI badges (via
 * `topoLevels`), the run dig-in (active + prior cycles), demo-builder link,
 * plan/start-development triggers, and the recovery region
 * (`data-section="recovery-detail"`) all live here. `RoadmapNode` now owns
 * only the click-to-toggle header + the default-collapsed uniform card; this
 * component owns everything that used to be `[data-node-detail]`'s children
 * — including the `[data-node-detail]` wrapper itself, so the caller only
 * has to pass `expanded` and does not have to re-implement the
 * always-mounted / display-toggled contract (AT5: the recovery-detail region
 * must never be reachable only through a click, or it silently vanishes from
 * a re-homed subtree).
 *
 * W6-RV-2: hosted inside `RoadmapCanvas`'s push drawer now (always rendered
 * `expanded={true}` there — the canvas itself never inline-expands a card).
 * One small ADDITIVE change for the canvas world: `onDepJump`, when passed,
 * turns the "Depends on" line's ids into individually-clickable
 * `[data-dep-jump]` spans (the b-prime mock's dep-chip jump/pan behaviour) —
 * every existing data-* attribute and the rest of the DOM shape are
 * untouched; omitting the prop (no consumer does, post-RV-2) falls back to
 * the original plain-text join.
 */

import * as React from 'react';
import { useCallback } from 'react';
import Link from 'next/link';

import type { RoadmapWorkItem, RecoveryInspect } from '@/lib/bridge-client';
import type { TopoLevelResult } from '@/lib/dep-layout';
import { isRecoverableStatus, type AttemptInfo } from '@/lib/recovery-attrs';
import type { DevelopCardState, PlanCardState } from './RoadmapCanvas';

export type InitiativeDetailProps = {
  /** Visual toggle only — this component is ALWAYS mounted (see AT5 note
   *  above); `expanded` just switches `display: flex` vs `none`. */
  expanded: boolean;
  initiativeId: string;
  status: string;
  dependsOnInitiatives: string[];
  blocked: boolean;
  blockedBy: string[];
  unplanned: boolean;
  wiLevels: TopoLevelResult<RoadmapWorkItem> | null;
  /** Active cycle first (index 0), then every prior (completed) attempt. */
  runCycleIds: string[];
  onOpenDemo?: () => void;
  plan: PlanCardState;
  onPlan?: (initiativeId: string) => void | Promise<void>;
  canStartDevelopment: boolean;
  develop: DevelopCardState;
  onStart?: (initiativeId: string) => void | Promise<void>;
  attempt: AttemptInfo;
  recoveryDetail: RecoveryInspect | null;
  recoveryBusy: boolean;
  recoveryNote: string;
  onInspectRecovery: () => void | Promise<void>;
  onRecoveryAction: (kind: 'requeue' | 'abandon') => void | Promise<void>;
  /** W6-RV-2: when present, each dependency id in the "Depends on" line
   *  becomes a `[data-dep-jump]` click target instead of plain text. */
  onDepJump?: (initiativeId: string) => void;
};

export function InitiativeDetail({
  expanded,
  initiativeId,
  status,
  dependsOnInitiatives,
  blocked,
  blockedBy,
  unplanned,
  wiLevels,
  runCycleIds,
  onOpenDemo,
  plan,
  onPlan,
  canStartDevelopment,
  develop,
  onStart,
  attempt,
  recoveryDetail,
  recoveryBusy,
  recoveryNote,
  onInspectRecovery,
  onRecoveryAction,
  onDepJump,
}: InitiativeDetailProps) {
  const handleInspect = useCallback(() => void onInspectRecovery(), [onInspectRecovery]);
  const handleRequeue = useCallback(() => void onRecoveryAction('requeue'), [onRecoveryAction]);
  const handleAbandon = useCallback(() => void onRecoveryAction('abandon'), [onRecoveryAction]);
  // Reviewer finding (MEDIUM): a dep-jump chip is a real interactive
  // control (it selects + pans the canvas), not decorative text, so it
  // needs the same activation contract a native <button> gets for free —
  // a bare <span onClick> is mouse/pointer-only and invisible to keyboard
  // navigation and screen readers.
  const handleDepJumpKeyDown = useCallback(
    (depId: string) => (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onDepJump?.(depId);
      }
    },
    [onDepJump],
  );

  return (
    <div
      data-node-detail
      style={{ display: expanded ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}
    >
      {dependsOnInitiatives.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--dim)' }}>
          Depends on:{' '}
          {onDepJump
            ? dependsOnInitiatives.map((depId, idx) => (
                <React.Fragment key={depId}>
                  {idx > 0 && ', '}
                  <span
                    data-dep-jump={depId}
                    role="button"
                    tabIndex={0}
                    onClick={() => onDepJump(depId)}
                    onKeyDown={handleDepJumpKeyDown(depId)}
                    style={{ color: 'var(--c-dev, #4ca3f5)', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {depId}
                  </span>
                </React.Fragment>
              ))
            : dependsOnInitiatives.join(', ')}
        </div>
      )}

      {blocked && (
        <div data-section="initiative-blocked" style={{ fontSize: 11, color: 'var(--amber, #d29922)' }}>
          Blocked by: {blockedBy.join(', ')}
        </div>
      )}

      {unplanned && (
        <div data-section="initiative-blocked-until-planned" style={{ fontSize: 11, color: 'var(--amber, #d29922)' }}>
          Not yet planned — decompose it before starting development.
        </div>
      )}

      {wiLevels && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>Work Items</div>
          {Array.from({ length: wiLevels.maxLevel + 1 }, (_, lvl) =>
            (wiLevels.byLevel.get(lvl) ?? []).map((w) => <WorkItemBadge key={w.id} wi={w} />),
          )}
        </div>
      )}

      {/* R4-13 run dig-in: active + prior (completed) cycles, joined on cycleId. */}
      {runCycleIds.length > 0 && (
        <div data-section="initiative-runs" style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>Runs</div>
          {runCycleIds.map((cycleId, idx) => (
            <Link
              key={cycleId}
              data-run-link
              data-run-cycle-id={cycleId}
              data-run-active={idx === 0 ? 'true' : 'false'}
              href={`/flows/forge-develop/run/${cycleId}`}
              style={{ fontSize: 11, color: 'var(--c-dev, #4ca3f5)', textDecoration: 'underline' }}
            >
              {idx === 0 ? 'active run' : 'prior run'} · {cycleId} →
            </Link>
          ))}
        </div>
      )}

      {onOpenDemo && (
        <button
          data-link="demo-builder"
          onClick={onOpenDemo}
          style={{
            alignSelf: 'flex-start', fontSize: 11, color: 'var(--c-project, #1f6feb)',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          demo builder →
        </button>
      )}

      {/* R4-11-F2: Plan trigger — only on a WI-less pending initiative. */}
      {unplanned && plan.status !== 'started' && (
        <button
          data-action="plan-initiative"
          data-initiative-id={initiativeId}
          disabled={plan.status === 'planning' || !onPlan}
          onClick={() => void onPlan?.(initiativeId)}
          style={{
            marginTop: 4, alignSelf: 'flex-start',
            color: '#fff', background: plan.status === 'error' ? '#9e6a03' : '#1f6feb',
            border: '1px solid var(--line)', borderRadius: 6, padding: '6px 14px',
            fontSize: 12, fontWeight: 600, cursor: plan.status === 'planning' ? 'default' : 'pointer',
            opacity: plan.status === 'planning' ? 0.6 : 1,
          }}
        >
          {plan.status === 'planning' ? 'planning…' : plan.status === 'error' ? 'retry — plan' : 'Plan →'}
        </button>
      )}
      {unplanned && plan.status === 'error' && plan.error && (
        <div style={{ fontSize: 11, color: 'var(--red, #f85149)' }}>{plan.error}</div>
      )}
      {unplanned && plan.status === 'started' && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--green, #3fb950)', fontWeight: 600 }}>Planning started — the initiative will be decomposed into work items.</span>
          <Link data-action="open-plan-run" href="/flows/forge-architect" style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}>
            view run →
          </Link>
        </div>
      )}

      {/* S7: start-development trigger — only on a decomposed, not-yet-developing initiative. */}
      {canStartDevelopment && develop.status !== 'started' && (
        <button
          data-action="start-development"
          data-initiative-id={initiativeId}
          disabled={develop.status === 'starting' || !onStart}
          onClick={() => void onStart?.(initiativeId)}
          style={{
            marginTop: 4, alignSelf: 'flex-start',
            color: '#fff', background: develop.status === 'error' ? '#9e6a03' : '#238636',
            border: '1px solid var(--line)', borderRadius: 6, padding: '6px 14px',
            fontSize: 12, fontWeight: 600, cursor: develop.status === 'starting' ? 'default' : 'pointer',
            opacity: develop.status === 'starting' ? 0.6 : 1,
          }}
        >
          {develop.status === 'starting' ? 'starting…' : develop.status === 'error' ? 'retry — start development' : 'Start development →'}
        </button>
      )}
      {develop.status === 'error' && develop.error && (
        <div style={{ fontSize: 11, color: 'var(--red, #f85149)' }}>{develop.error}</div>
      )}
      {develop.status === 'started' && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--green, #3fb950)', fontWeight: 600 }}>Development started — the unifier will open a PR for review.</span>
          <Link data-action="open-develop-run" href="/flows/forge-develop" style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}>
            view run →
          </Link>
        </div>
      )}

      {/* R4-11-T3: recovery affordances — gated on the recoverable set
          (in-flight / ready-for-review / failed). The recovery-detail region
          is rendered UNCONDITIONALLY (populated by Inspect) so the re-home
          cannot drop a click-gated affordance. */}
      {isRecoverableStatus(status) && (
        <div
          data-recovery-item
          data-recovery-initiative={initiativeId}
          data-recovery-status={status}
          data-recovery-attempt-count={attempt.attemptCount}
          style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
              Recovery
              {attempt.attemptCount > 1 && (
                <span
                  data-recovery-prior-attempts={attempt.attemptCount - 1}
                  title={`${attempt.attemptCount - 1} prior attempt(s): ${attempt.priorCycleIds.join(', ')}`}
                  style={{ marginLeft: 8, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--faint)', fontSize: 10.5 }}
                >
                  ×{attempt.attemptCount}
                </span>
              )}
            </div>
            <span style={{ display: 'flex', gap: 6 }}>
              <button data-action="recovery-inspect" onClick={handleInspect} style={recoveryBtn('var(--line)')}>Inspect</button>
              <button data-action="recovery-requeue" disabled={recoveryBusy} onClick={handleRequeue} style={recoveryBtn('#1f6feb')}>Requeue</button>
              <button data-action="recovery-abandon" disabled={recoveryBusy} onClick={handleAbandon} style={recoveryBtn('#a33')}>Abandon</button>
            </span>
          </div>

          <div data-section="recovery-detail" data-recovery-detail-initiative={initiativeId} style={{ fontSize: 11, color: 'var(--dim)' }}>
            {recoveryDetail ? (
              <>
                <div>branch: <code>{recoveryDetail.branch}</code> · worktree: {recoveryDetail.worktreeExists ? 'preserved' : 'gone'} · PR draft: {recoveryDetail.prDraftChars ?? 0} chars</div>
                {recoveryDetail.commits && recoveryDetail.commits.length > 0 && (
                  <pre data-recovery-commits style={{ background: 'var(--bg)', padding: 6, borderRadius: 4, marginTop: 4, overflowX: 'auto' }}>
                    {recoveryDetail.commits.join('\n')}
                  </pre>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--faint)', fontStyle: 'italic' }}>Inspect to load branch / worktree / PR-draft detail.</span>
            )}
          </div>
          {recoveryNote && <p data-recovery-note style={{ fontSize: 11, color: 'var(--faint)', margin: 0 }}>{recoveryNote}</p>}
        </div>
      )}
    </div>
  );
}

function recoveryBtn(bg: string): React.CSSProperties {
  return { fontSize: 10, padding: '2px 8px', background: bg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' };
}

function WorkItemBadge({ wi }: { wi: RoadmapWorkItem }) {
  return (
    <div
      data-work-item-id={wi.id}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: 'var(--text)',
        background: 'var(--bg)', borderRadius: 'var(--radius-sm)',
        padding: '5px 9px', border: '1px solid var(--line)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'var(--c-dev, #4ca3f5)', fontWeight: 700 }}>{wi.id}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wi.title}</span>
    </div>
  );
}
