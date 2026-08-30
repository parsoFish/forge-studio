'use client';

/**
 * The id a surface just MINTED, rendered before the navigation that consumes
 * it — onboarding's `data-onboard-session-id` convention, extracted so the
 * other kinds adopt it in two lines (`forge-8vfn.5.5`; the contract doc carries
 * the rule). No id, no element: the link cannot point at a session that was
 * never created.
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
