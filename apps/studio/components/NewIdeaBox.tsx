'use client';

import { useMemo, useState } from 'react';

import { startArchitect } from '@/lib/bridge-client';
import { KickoffModelTierPicker, allowedTiersFromCapability } from '@/components/studio/session/KickoffModelTierPicker';
import { kickoffCeilingInvalidReason, reconcileProjectPrefill } from '@/lib/kickoff-form';
import { SessionMinted } from '@/components/studio/session/SessionMinted';
import type { ProjectRoster } from '@/lib/use-project-roster';

/**
 * ADR 020 — the operator's entry point into the in-UI architect. This is the
 * ONE architect kickoff form (W7-B6: `/architect/new` and
 * `/sessions/architect/new` both render it — the two entries converge here);
 * forge never auto-starts the architect (preserves the
 * impossible-to-auto-satisfy property of the human moment).
 *
 * W7-B6 (projects-14/-15, sessions-kinds-03/-04, crosscut-21/-25):
 *   - the project field is a SELECT over the real roster IDS (label
 *     "name (id)") — never free text, so a typo can't mint a phantom project
 *     (the bridge additionally 404s an unknown project);
 *   - an `initialProject` (?project= deep link) that is NOT in the roster is
 *     surfaced as an honest notice (`data-unknown-project`) and never
 *     submitted;
 *   - the SKILL.md-declared model-tier envelope renders like every other
 *     kickoff (`KickoffModelTierPicker` — architect is strategy:fixed today,
 *     so this states the tier that will run);
 *   - an optional session cost ceiling (USD) rides to
 *     `POST /api/architect/start` and is enforced by the runner at every
 *     turn start; an untouched/blank field sends NOTHING;
 *   - the disabled Start button explains itself (`data-disabled-reason`);
 *   - styles ride the shared Studio tokens, not hardcoded GitHub hexes.
 */
export function NewIdeaBox({
  roster,
  initialProject = '',
}: {
  /** Owned by the HOST route, so the route can derive its own `data-page-ready`
   *  from the same state this form renders as `data-roster-state`
   *  (`forge-8vfn.5.7`). */
  roster: ProjectRoster;
  initialProject?: string;
}) {
  const [projectPicked, setProjectPicked] = useState<string | null>(null);
  const [idea, setIdea] = useState('');
  const [modelTier, setModelTier] = useState('');
  const [ceilingRaw, setCeilingRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // forge-8vfn.5.5: the id this form MINTS, rendered before the navigation
  // that consumes it — the `data-onboard-session-id` convention, which was the
  // one place in Studio where a session id was observable in time.
  //
  // forge-8vfn.6.11.5: it is published only ONCE IT EXISTS. The wrapper used
  // to render `data-architect-session-id={startedSessionId ?? ''}` — present
  // and empty from first paint — so a consumer waiting for the key to appear
  // was answered instantly by a value naming no session, and S2 beat 10 read
  // `expected a value to bind as <architectSessionId>, got ""` on a run whose
  // architect really had started. `SessionMinted` below states the rule this
  // now follows: no id, no claim.
  const [startedSessionId, setStartedSessionId] = useState<string | null>(null);

  // crosscut-21: honour a ?project= prefill ONLY when it names a real roster
  // id; a stale bookmark surfaces a notice, never a submit. DERIVED from the
  // roster rather than copied into state by an effect, so the notice cannot
  // outlive the roster it was computed from. (Shared rule:
  // lib/kickoff-form.ts, also used by the generic kickoff page — review F2.)
  const reconciled = useMemo(
    () => reconcileProjectPrefill(initialProject, roster.projects.map((p) => p.id)),
    [initialProject, roster.projects],
  );
  const project = projectPicked ?? reconciled.project;
  const unknownInitial = reconciled.unknownPrefill;
  const { capability, state: rosterState } = roster;
  const projects = roster.projects;

  const isRangeTier = allowedTiersFromCapability(capability).length > 0;
  const ceilingUsd = ceilingRaw.trim() === '' ? undefined : Number(ceilingRaw);
  // Review F8: ONE validation rule (lib/kickoff-form.ts), including the
  // server's MAX_KICKOFF_COST_CEILING_USD cap — an over-cap value must
  // disable Start with the reason stated, not 400 after a round-trip.
  const ceilingReason = kickoffCeilingInvalidReason(ceilingUsd);
  const ceilingInvalid = ceilingReason !== null;
  const disabledReason = submitting
    ? null
    : rosterState === 'error'
      ? 'the project roster could not be loaded — retry once the bridge is reachable'
      : project.trim() === ''
        ? 'select a project'
        : idea.trim() === ''
          ? 'describe the idea'
          : ceilingReason;
  const canSubmit = disabledReason === null && !submitting;

  async function onSubmit(): Promise<void> {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await startArchitect({
        project: project.trim(),
        idea: idea.trim(),
        ...(isRangeTier && modelTier ? { modelTier } : {}),
        ...(ceilingUsd !== undefined && !ceilingInvalid ? { costCeilingUsd: ceilingUsd } : {}),
      });
      if (!res.ok) { setError(res.error ?? 'failed to start'); return; }
      setIdea('');
      if (res.sessionId) setStartedSessionId(res.sessionId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-section="new-idea"
      data-new-idea-ready={canSubmit ? 'true' : 'false'}
      data-roster-state={rosterState}
      {...(startedSessionId === null ? {} : { 'data-architect-session-id': startedSessionId })}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: 16,
        background: 'var(--bg-2)',
      }}
    >
      {unknownInitial && (
        <div data-unknown-project={unknownInitial} style={{ color: 'var(--red, #f87171)', fontSize: 12, marginBottom: 10 }}>
          Project &quot;{unknownInitial}&quot; is not in the roster — pick a real project below (or onboard it first).
        </div>
      )}
      <label style={labelStyle} htmlFor="new-idea-project">Project</label>
      <select
        id="new-idea-project"
        value={project}
        onChange={(e) => setProjectPicked(e.target.value)}
        data-field="project"
        style={inputStyle}
      >
        <option value="">{rosterState === 'loading' ? 'loading projects…' : rosterState === 'error' ? 'roster unavailable' : 'select a project…'}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name === p.id ? p.id : `${p.name} (${p.id})`}
          </option>
        ))}
      </select>
      <label style={labelStyle} htmlFor="new-idea-idea">Idea</label>
      <textarea
        id="new-idea-idea"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Describe the idea, pain point, or brief…"
        rows={3}
        data-field="idea"
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
      <KickoffModelTierPicker capability={capability} modelTier={modelTier} onChange={setModelTier} />
      <label style={{ ...labelStyle, marginTop: 10 }} htmlFor="new-idea-ceiling">Cost ceiling (USD, optional)</label>
      <input
        id="new-idea-ceiling"
        type="number"
        min={0}
        step="0.5"
        value={ceilingRaw}
        onChange={(e) => setCeilingRaw(e.target.value)}
        placeholder="no ceiling"
        data-field="cost-ceiling-usd"
        style={{ ...inputStyle, maxWidth: 140 }}
      />
      <div style={{ fontSize: 11, color: 'var(--faint)', margin: '-4px 0 10px' }}>
        Enforced at every turn: a turn that would start past the ceiling refuses instead of overrunning. Blank sends nothing.
      </div>
      {error && (
        <div data-new-idea-error style={{ color: 'var(--red, #f87171)', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="btn btn-primary"
          onClick={() => void onSubmit()}
          disabled={!canSubmit}
          data-action="start-architect"
          {...(disabledReason ? { 'data-disabled-reason': disabledReason, title: disabledReason } : {})}
          style={{ opacity: canSubmit ? 1 : 0.5 }}
        >
          {submitting ? 'Starting…' : 'Start architect'}
        </button>
        {disabledReason && (
          <span data-section="start-architect-hint" style={{ fontSize: 11.5, color: 'var(--faint)' }}>
            {disabledReason}
          </span>
        )}
      </div>
      <SessionMinted kind="architect" sessionId={startedSessionId} />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--faint)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  marginBottom: 10,
};
