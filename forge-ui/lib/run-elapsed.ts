/**
 * run-elapsed — a run's elapsed time (W7-A3, flows-29). A finished run's
 * elapsed is `completedAt − startedAt` and never depends on the wall clock;
 * only a live run counts against `nowMs`.
 */
export function formatRunElapsed(startedAt: string | undefined, completedAt: string | undefined, nowMs: number): string {
  if (!startedAt) return '—';
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : nowMs;
  const ms = end - start;
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalM = Math.floor(ms / 60_000);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
