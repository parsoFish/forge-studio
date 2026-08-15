'use client';

import { useState } from 'react';

import { postSessionAffordance, type SessionAffordance, type SessionArtifactPayload } from '@/lib/session-client';

// ---------------------------------------------------------------------------
// SessionInteractivePanel — the GENERIC interaction panel (W6-B6, ADR-043
// docs/decisions/043-generic-interactive-surface.md 2026-08-15 amendment §1).
//
// Renders EXCLUSIVELY from the GET session-shell route's own `affordances[]`
// (`orchestrator/studio/session-kinds.ts`'s `deriveSessionAffordances`,
// threaded onto the wire by `cli/bridge-studio-sessions.ts`, parsed by
// `forge-ui/lib/session-client.ts`) — it NEVER re-derives an affordance from
// `phase` itself. Availability is recomputed server-side on every GET AND
// re-checked server-side on every POST (`cli/bridge-studio-affordances.ts`,
// W6-B4) — a stale client that fires a phase-inappropriate affordance id
// 409s exactly as a forged one would; this panel is a thin, honest renderer
// over that already-derived contract, not a second source of truth.
//
// THIS BATCH (W6-B6): wired into the session shell for `demo` and
// `onboarding` only — architect/instructions/kb-cleanup/authoring keep their
// bespoke panels (`SessionArchitectPanel` / `SessionInstructionsPanel` /
// `SessionCleanupPanel` / `SessionAuthoringPanel`) until B8/B9 migrate them
// onto this generic surface. Architect never migrates (ADR-043 amendment §4
// — its branching council/interview control flow has no linear phase-table
// seam); it stays permanently bespoke.
//
// Per-affordance-kind rendering:
//   - `question-form` — a free-text answer box (this batch's B4/B6 pass has
//     no per-question granularity on the wire yet — the operator reads the
//     actual question text in the transcript pane to the LEFT of this panel
//     and replies here; a future batch that threads structured
//     `questions.json` rows onto the shell payload can replace this single
//     box with per-question fields without touching the POST contract).
//     Submits `{answers: [{question, answer}]}` — B4's
//     `handleInstructionsAnswer`'s exact body shape.
//   - `verdict` — approve/reject buttons. `demo`'s approve additionally
//     offers a generation picker (B4's `handleDemoVerdict` accepts an
//     optional `generation`) when the session's own artifact is a real
//     `generation-gallery` with at least one generation. `kb-cleanup` and
//     `authoring` render APPROVE ONLY — B4's own table declares no
//     rejection path for either (a `reject` 422s there), so offering the
//     button here would be a control known in advance to fail.
//   - `staged-review` / `next-turn` — rendered DISABLED, honestly labelled
//     "not yet wired" — B4 returns 501 `UnhandledAffordanceBody` for both
//     (they describe what an `agent` step already did / where it advances
//     to, not an operator write action).
//
// Every endpoint error — 409 wrong-phase (naming the offending affordance id
// + the currently-available set), 422, 501 UnhandledAffordanceBody — reaches
// the operator VERBATIM via `data-affordance-error`, never swallowed and
// never replaced by a generic "failed" string.
// ---------------------------------------------------------------------------

/** B4's own table (`cli/bridge-studio-affordances.ts`'s
 *  `handleKbCleanupVerdict`/`handleAuthoringVerdict`) declares NO rejection
 *  semantics for either kind — a `verdict: 'reject'` 422s. Named here so the
 *  UI never offers a control known in advance to fail, mirroring
 *  `SessionCleanupPanel`'s own "never a button that's known to error"
 *  discipline. */
const APPROVE_ONLY_KINDS: ReadonlySet<string> = new Set(['kb-cleanup', 'authoring']);

/** Affordance kinds this route has no write handler for at all (B4's
 *  `unhandledAffordanceBody` fallthrough) — rendered disabled, honestly. */
const NOT_YET_WIRED_KINDS: ReadonlySet<SessionAffordance['kind']> = new Set(['staged-review', 'next-turn']);

function generationOptions(artifact: SessionArtifactPayload | null): number[] {
  if (!artifact || artifact.kind !== 'generation-gallery') return [];
  return artifact.generations.map((g) => g.number).sort((a, b) => b - a);
}

export function SessionInteractivePanel({
  kind,
  sessionId,
  project,
  phase,
  affordances,
  artifact = null,
  modelTier = null,
  onChanged,
}: {
  /** The session-kind id (e.g. 'demo', 'onboarding') — the POST route's own
   *  `:kind` segment. */
  kind: string;
  sessionId: string;
  project: string | null;
  /** The session's CURRENT phase — shown only in the provenance strip; every
   *  actual affordance decision comes from `affordances[]` itself, never
   *  re-derived from this value. */
  phase: string;
  affordances: SessionAffordance[];
  artifact?: SessionArtifactPayload | null;
  /** Read-only — the session's kickoff-selected tier, or `null` when none
   *  was recorded. Never editable from this panel (ADR-043 §3: the tier is
   *  chosen once, at kickoff). */
  modelTier?: string | null;
  /** Called after ANY successful POST (question-form submit or verdict) so
   *  the caller can re-fetch the session shell. Optional — a panel under a
   *  DOM-pin test never passes one. */
  onChanged?: () => void;
}): JSX.Element {
  const [answerText, setAnswerText] = useState('');
  const [pickedGeneration, setPickedGeneration] = useState<string>('');
  const [busyAffordanceId, setBusyAffordanceId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const generations = kind === 'demo' ? generationOptions(artifact) : [];

  async function submit(affordance: SessionAffordance, body: Record<string, unknown>): Promise<void> {
    if (!project) {
      setErrors((prev) => ({ ...prev, [affordance.id]: 'no project known for this session — cannot submit' }));
      return;
    }
    setBusyAffordanceId(affordance.id);
    setErrors((prev) => {
      const { [affordance.id]: _drop, ...rest } = prev;
      return rest;
    });
    const result = await postSessionAffordance(kind, sessionId, affordance.id, { project, ...body });
    setBusyAffordanceId(null);
    if (!result.ok) {
      // Never swallowed — the server's own message (409 available-set, 422,
      // 501 UnhandledAffordanceBody) reaches the operator verbatim.
      setErrors((prev) => ({ ...prev, [affordance.id]: result.error }));
      return;
    }
    setAnswerText('');
    onChanged?.();
  }

  if (affordances.length === 0) {
    return (
      <div data-component="session-interactive-panel" data-affordance-count={0}>
        <ProvenanceStrip phase={phase} modelTier={modelTier} />
        <div data-section="session-no-affordances" style={{ fontSize: 12.5, color: 'var(--faint)', padding: '10px 0' }}>
          No operator action available for this session kind right now.
        </div>
      </div>
    );
  }

  return (
    <div data-component="session-interactive-panel" data-affordance-count={affordances.length}>
      <ProvenanceStrip phase={phase} modelTier={modelTier} />

      {affordances.map((affordance) => {
        const error = errors[affordance.id];
        const busy = busyAffordanceId === affordance.id;

        if (affordance.kind === 'question-form') {
          return (
            <div key={affordance.id} data-section="session-affordance" data-affordance-kind="question-form" style={sectionStyle}>
              <div style={labelStyle}>Answer</div>
              <textarea
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="Your answer…"
                rows={3}
                data-field="session-answer"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
              {error && <ErrorLine message={error} />}
              <button
                type="button"
                className="btn btn-primary"
                data-action="submit-answers"
                disabled={busy || answerText.trim().length === 0}
                onClick={() => void submit(affordance, { answers: [{ question: 'Operator response', answer: answerText.trim() }] })}
                style={{ opacity: busy || answerText.trim().length === 0 ? 0.5 : 1 }}
              >
                {busy ? 'Sending…' : 'Send answer'}
              </button>
            </div>
          );
        }

        if (affordance.kind === 'verdict') {
          const approveOnly = APPROVE_ONLY_KINDS.has(kind);
          return (
            <div key={affordance.id} data-section="session-affordance" data-affordance-kind="verdict" style={sectionStyle}>
              {kind === 'demo' && generations.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={labelStyle}>Generation to lock (optional — defaults to the latest)</div>
                  <select
                    value={pickedGeneration}
                    onChange={(e) => setPickedGeneration(e.target.value)}
                    data-field="session-generation-pick"
                    style={inputStyle}
                  >
                    <option value="">auto (latest — #{generations[0]})</option>
                    {generations.map((n) => (
                      <option key={n} value={n}>
                        generation #{n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {error && <ErrorLine message={error} />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-action="verdict-approve"
                  disabled={busy}
                  onClick={() =>
                    void submit(affordance, {
                      verdict: 'approve',
                      ...(kind === 'demo' && pickedGeneration ? { generation: Number(pickedGeneration) } : {}),
                    })
                  }
                  style={{ opacity: busy ? 0.5 : 1 }}
                >
                  {busy ? 'Working…' : 'Approve'}
                </button>
                {!approveOnly && (
                  <button
                    type="button"
                    className="btn"
                    data-action="verdict-reject"
                    disabled={busy}
                    onClick={() => void submit(affordance, { verdict: 'reject' })}
                    style={{ opacity: busy ? 0.5 : 1 }}
                  >
                    {busy ? 'Working…' : 'Reject'}
                  </button>
                )}
              </div>
            </div>
          );
        }

        if (NOT_YET_WIRED_KINDS.has(affordance.kind)) {
          return (
            <div key={affordance.id} data-section="session-affordance" data-affordance-kind={affordance.kind} style={sectionStyle}>
              <button type="button" className="btn" disabled style={{ opacity: 0.4 }}>
                {affordance.kind === 'staged-review' ? 'Review staged files' : 'Advance turn'}
              </button>
              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 6 }}>not yet wired</div>
            </div>
          );
        }

        // Structurally unreachable (SessionAffordanceKind's closed vocabulary
        // is exactly the four cases above) — fails honestly rather than
        // silently rendering nothing for a future kind this panel hasn't
        // been taught yet.
        return (
          <div key={affordance.id} data-section="session-affordance" data-affordance-kind={affordance.kind} style={sectionStyle}>
            <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>unrecognised affordance kind &quot;{affordance.kind}&quot;</div>
          </div>
        );
      })}
    </div>
  );
}

function ProvenanceStrip({ phase, modelTier }: { phase: string; modelTier: string | null }): JSX.Element {
  return (
    <div
      data-section="session-provenance"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--faint)',
        fontFamily: 'ui-monospace, Menlo, monospace', padding: '2px 0 10px',
      }}
    >
      <span>derived from phase {phase}</span>
      <span
        data-component="session-model-chip"
        data-model-tier={modelTier ?? ''}
        style={{
          border: '1px solid var(--line-2)', borderRadius: 999, padding: '1px 8px',
          color: 'var(--dim)', whiteSpace: 'nowrap',
        }}
      >
        model: {modelTier ?? 'default'}
      </span>
    </div>
  );
}

function ErrorLine({ message }: { message: string }): JSX.Element {
  return (
    <div data-affordance-error style={{ fontSize: 12.5, color: 'var(--red, #f87171)', margin: '6px 0' }}>
      {message}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px',
  background: 'var(--panel)', marginBottom: 10,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--dim)', marginBottom: 6,
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
};
