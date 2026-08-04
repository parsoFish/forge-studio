/**
 * Pure view-state derivation for the /community browse page +
 * /community/[kind]/[id] detail page (R3-07-F1).
 *
 * Mirrors connection-library-view.ts's testability convention exactly: no
 * DOM, no React, no network, no re-derivation of any server-computed fact
 * (installState, probeState, hub match, signals) — this module assumes a
 * parsed, already-trustworthy `CommunityItem`/`CommunityHub` (from
 * ./community-client.ts) and only ever reshapes it for rendering.
 * Immutability: every function returns a NEW array, never mutates its input.
 *
 * D2 — this file owns ZERO trust decisions: it never references
 * approve/override/re-pin machinery, not even in a comment
 * (cli/community-no-trust-decisions.test.ts scans this file's source text).
 */

import type { CommunityItem, CommunityKind, CommunityInstallState, CommunityHub, CommunitySignals } from './community-client.ts';

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Filter by kind, or pass every item through unfiltered for 'all'. Always
 *  returns a NEW array — never the same reference as `items`, even for the
 *  unfiltered case, so a caller can never mistake it for a live view onto
 *  the input. */
export function filterByKind(items: readonly CommunityItem[], kind: CommunityKind | 'all'): CommunityItem[] {
  if (kind === 'all') return [...items];
  return items.filter((item) => item.kind === kind);
}

/** Case-insensitive match on name + desc. Empty query returns a NEW array of
 *  every item, unfiltered. */
export function filterCommunityItems(items: readonly CommunityItem[], query: string): CommunityItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// installStateLabel — D3: four distinct, non-empty labels. "needs-review"
// must read distinctly from "installed" — a tampered item must never be
// presented as trustworthy.
// ---------------------------------------------------------------------------

const INSTALL_STATE_LABELS: Record<CommunityInstallState, string> = {
  'not-installed': 'Not installed',
  'draft-pending-approval': 'Draft — pending approval',
  'needs-review': 'Needs review — do not trust yet',
  installed: 'Installed',
};

export function installStateLabel(state: CommunityInstallState): string {
  return INSTALL_STATE_LABELS[state];
}

// ---------------------------------------------------------------------------
// signalsLabel — D5: an item with no published signals renders the
// spec-literal "no signals published", never a fabricated zero. A real
// signal always carries both the figure AND its curated attribution — never
// presented as forge's own ranking.
// ---------------------------------------------------------------------------

export function signalsLabel(signals: CommunitySignals | null): string {
  if (signals === null) return 'no signals published';
  return `★ ${signals.stars} · curated by ${signals.attributedTo}`;
}

// ---------------------------------------------------------------------------
// hubLabel — D4: a null hub renders the spec-literal "unaffiliated", never
// an invented hub name.
// ---------------------------------------------------------------------------

export function hubLabel(hub: CommunityHub | null): string {
  if (hub === null) return 'unaffiliated';
  return hub.name;
}
