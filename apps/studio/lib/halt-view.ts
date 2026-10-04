/**
 * halt-view — the ONE formatter for the emergency halt's drain line, shared by
 * the global banner and `<ServeStatusNotice>` so the two can never say it two ways.
 */
import type { ServeHalt } from './bridge-client-core';

function hhmm(since: string | null): string | null {
  if (since === null) return null;
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function describeHalt(halt: ServeHalt): string {
  const t = hhmm(halt.since);
  const head = `Emergency halt on${t === null ? '' : ` since ${t}`}`;
  const queued = halt.queued === null ? 'Queued runs' : `${halt.queued} queued`;
  const tail = `${queued}, waiting for release.`;
  if (halt.active === null) return `${head} — nothing new starts. ${tail}`;
  if (halt.active > 0) {
    return `${head} — ${halt.active} ${halt.active === 1 ? 'run' : 'runs'} finishing, nothing new starts. ${tail}`;
  }
  return `${head} — every active run finished. ${tail}`;
}
