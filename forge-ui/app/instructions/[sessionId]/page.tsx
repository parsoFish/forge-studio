import { redirect } from 'next/navigation';

/**
 * Retired instructions-creator interview screen (R2-10 PR2, WI-8). Replaced
 * by the shared session shell, which carries every operator affordance this
 * page had (briefing, question form, activity log, draft verdict gate) under
 * one route generic over session kind: `/sessions/instructions/<sid>`. This
 * route now permanently redirects there so any stale inbound link (a
 * bookmark, a doc reference, the project builder's "Edit AGENTS.md" launch
 * before it was repointed) keeps working.
 */
export default function RetiredInstructionsSessionPage({
  params,
}: {
  params: { sessionId: string };
}): never {
  redirect(`/sessions/instructions/${encodeURIComponent(params.sessionId)}`);
}
