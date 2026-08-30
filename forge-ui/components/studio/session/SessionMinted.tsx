'use client';

/**
 * The id a surface just MINTED, rendered before the navigation that consumes it.
 *
 * `forge-8vfn.5.5`. Studio minted architect and demo session ids inside the
 * same click that `router.push`ed at them, so the id was never a `data-*`
 * value anything could observe: no story could bind `/sessions/demo/<id>` or
 * `/sessions/architect/<id>`, which blocked S1, S2, S4, S5, S6, S7 and S9.
 * Onboarding was the one surface that got it right — it renders
 * `data-onboard-session-id` and offers
 * `[data-action="view-onboarding-session"]` as a separate act — and this is
 * that convention, extracted so the remaining kinds adopt it in two lines
 * rather than re-deriving it.
 *
 * The id is rendered from the mint result and nothing else holds a copy of it,
 * so the link can never point at a session that was never created: no id, no
 * element.
 */
export function SessionMinted({
  kind,
  sessionId,
  project,
}: {
  kind: 'architect' | 'demo';
  sessionId: string | null;
  project?: string;
}): JSX.Element | null {
  if (sessionId === null) return null;
  const query = project ? `?project=${encodeURIComponent(project)}` : '';
  return (
    <a
      className="btn btn-primary"
      data-action={`view-${kind}-session`}
      data-session-kind={kind}
      data-session-id={sessionId}
      href={`/sessions/${kind}/${encodeURIComponent(sessionId)}${query}`}
      style={{ display: 'inline-block', marginTop: 10 }}
    >
      Open the {kind} session →
    </a>
  );
}
