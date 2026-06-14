import { redirect } from 'next/navigation';

/**
 * Retired standalone architect screen (M7-4, ADR-031). The interview + PLAN gate
 * were rebuilt as native Forge Studio surfaces: the interview lives at
 * `/architect/<sid>/interview` (Studio chrome) and the PLAN gate routes through
 * `/artifact?run=_architect-<sid>&type=plan&mode=gate`. This route now permanently
 * redirects to the interview surface so any stale inbound link keeps working
 * without resurrecting the ScreenShell/MomentHex tree.
 */
export default function RetiredArchitectSessionPage({
  params,
}: {
  params: { sessionId: string };
}): never {
  redirect(`/architect/${encodeURIComponent(params.sessionId)}/interview`);
}
