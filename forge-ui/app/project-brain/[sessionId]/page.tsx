import { redirect } from 'next/navigation';

/**
 * Retired project-brain builder review screen (R2-10 PR2, WI-8). Replaced by
 * the shared session shell, which carries every operator affordance this
 * page had (briefing, theme review, approve/abandon) under one route generic
 * over session kind: `/sessions/project-brain/<sid>`. This route now
 * permanently redirects there so any stale inbound link keeps working —
 * forwarding the `?project=` query string the retired page relied on (the
 * shell falls back to it when the per-kind session summary hasn't resolved
 * yet; see `forge-ui/app/sessions/[kind]/[sessionId]/page.tsx`'s header).
 */
export default function RetiredProjectBrainSessionPage({
  params,
  searchParams,
}: {
  params: { sessionId: string };
  searchParams: { [key: string]: string | string[] | undefined };
}): never {
  const projectRaw = searchParams?.project;
  const project = Array.isArray(projectRaw) ? projectRaw[0] : projectRaw;
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';
  redirect(`/sessions/project-brain/${encodeURIComponent(params.sessionId)}${qs}`);
}
