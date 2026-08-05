import { redirect } from 'next/navigation';

/**
 * Retired native Studio architect interview screen (R2-10 PR2, WI-8, ADR-031
 * precedent). Replaced by the shared session shell, which carries every
 * operator affordance this page had (question form, activity log, plan-gate
 * handoff, stale-session re-run) under one route generic over session kind:
 * `/sessions/architect/<sid>`. This route now permanently redirects there so
 * any stale inbound link (a bookmark, a doc reference, `architect/[sessionId]/
 * page.tsx`'s own redirect) keeps working without resurrecting this tree —
 * and without chaining through a second redirect.
 */
export default function RetiredArchitectInterviewPage({
  params,
}: {
  params: { sessionId: string };
}): never {
  redirect(`/sessions/architect/${encodeURIComponent(params.sessionId)}`);
}
