/**
 * forge-nk1y.3 — reflections waiting on the operator, as Waiting on you rows.
 *
 * Stranger attempt 2 (Q9): after the merge the interactive reflector filed its
 * questions and nothing in Studio listed them. The bridge derives the pending
 * set (`GET /api/reflections/pending`); this maps each one to a row that opens
 * the ReflectionGate — the same door as the verdict page's "Reflect on this
 * cycle →" link.
 */
import type { PendingReflection, ProjectAttentionItem } from './bridge-client';
import { buildHomeAttention, buildKbAttention, buildKbDraftAttention, type HomeAttentionItem } from './home-view';
import type { Kb, SessionIndexRow } from './studio-client';

const STATUS: Record<PendingReflection['status'], Extract<HomeAttentionItem, { kind: 'reflection' }>['status']> = {
  awaiting: 'gated',
  unasked: 'unasked',
  unreadable: 'unreadable',
};

function text(p: PendingReflection): string {
  if (p.status === 'awaiting') {
    return `${p.initiativeId} · the reflection asks ${p.questions} question${p.questions === 1 ? '' : 's'}`;
  }
  if (p.status === 'unasked') return `${p.initiativeId} · the reflector asked nothing — close the reflection`;
  return `${p.initiativeId} · the reflection's questions cannot be read`;
}

/** The reflection gate for a cycle: the artifact viewer's reflection view. */
export function reflectionGateHref(cycleId: string): string {
  return `/artifact?run=${encodeURIComponent(cycleId)}&type=reflection&mode=view`;
}

export function buildReflectionAttention(pending: readonly PendingReflection[]): HomeAttentionItem[] {
  return pending.map((p) => ({
    id: `reflection-${p.cycleId}`,
    kind: 'reflection' as const,
    text: text(p),
    sub: `reflection · ${p.status}`,
    status: STATUS[p.status],
    href: reflectionGateHref(p.cycleId),
    cycleId: p.cycleId,
  }));
}

/**
 * Monitor's Waiting on you: every attention source in one dense list, built
 * from the same builders Home renders — project gates, then reflections, then
 * parked brain drafts, then KB lint. Pure, so the list's membership is
 * provable without mounting the page.
 */
export function buildWaitingOnYou(input: {
  attention: ProjectAttentionItem[];
  reflections: readonly PendingReflection[];
  sessions: readonly SessionIndexRow[];
  kbs: Kb[];
}): HomeAttentionItem[] {
  const gateItems = buildHomeAttention(input.attention);
  const reflectionItems = buildReflectionAttention(input.reflections);
  const kbDraftItems = buildKbDraftAttention(input.sessions).filter((i) => i.kind === 'kb-draft');
  const kbItems = buildKbAttention(input.kbs).filter((i) => i.kind === 'kb');
  return [...gateItems, ...reflectionItems, ...kbDraftItems, ...kbItems];
}
