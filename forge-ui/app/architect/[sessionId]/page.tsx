import { redirect } from 'next/navigation';

/**
 * Retired standalone architect screen (M7-4, ADR-031). The interview + PLAN gate
 * were rebuilt as native Forge Studio surfaces, then consolidated again onto the
 * shared session shell (R2-10 PR2, WI-8): the interview now lives at
 * `/sessions/architect/<sid>`, and the PLAN gate routes through
 * `/artifact?run=_architect-<sid>&type=plan&mode=gate`. This route redirects
 * straight to the shell — never through `/architect/<sid>/interview`, which is
 * now itself a redirect, so no request ever chains through two hops.
 */
export default function RetiredArchitectSessionPage({
  params,
}: {
  params: { sessionId: string };
}): never {
  redirect(`/sessions/architect/${encodeURIComponent(params.sessionId)}`);
}
