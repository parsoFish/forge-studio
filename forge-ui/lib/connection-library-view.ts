/**
 * Pure view-state derivation for the /connections library page +
 * /connections/[id] detail page (R3-04-F2/F3, `_wave5/specs/R3-04.md`).
 *
 * Mirrors hook-library-view.ts's testability convention: no DOM, no React,
 * no network, no re-derivation of server-computed facts (probe state,
 * capabilities-curation, usedBy) — this module assumes a parsed,
 * already-trustworthy `ConnectionWire` (from ./connection-client.ts) and only
 * ever reshapes it for rendering. Every function returns a NEW value; none
 * mutates its input (house immutability rule).
 *
 * `filterConnections`/`readinessCounts`/`connectionBadges`/
 * `blockedRunMessage`/`describeInstallOutcome` are the AT-pinned exports
 * (see forge-ui/lib/connection-library-view.test.ts). `unreadyBoundConnections`
 * and `configVarStatus` are additional pure helpers this module adds so the
 * pages themselves stay thin (WI-5 scope note: "This is where all logic
 * lives; the pages stay thin") — not directly AT-covered here, but every call
 * site is type-checked by `npm run build` and exercised by the pages.
 */

import type {
  ConnectionWire,
  ConnectionKind,
  ConnectionProbeState,
  ConnectionConfigVar,
} from './connection-client.ts';

// ---------------------------------------------------------------------------
// filterConnections — matches on name or description (case-insensitive).
// Empty query returns a NEW array of every entry, unfiltered.
// ---------------------------------------------------------------------------

export function filterConnections(entries: readonly ConnectionWire[], query: string): ConnectionWire[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => {
    const name = e.name.toLowerCase();
    // `desc` is a legitimately-OPTIONAL field on ConnectionWire (a curated
    // entry may declare none) — `?? ''` here matches an absent optional
    // field for search purposes. It is not the "malformed payload coerced to
    // a default" fabrication the house rule forbids — that refusal
    // discipline already lives in connection-client.ts's parser, which
    // throws on a REQUIRED field, not this one.
    const desc = (e.desc ?? '').toLowerCase();
    return name.includes(q) || desc.includes(q);
  });
}

// ---------------------------------------------------------------------------
// readinessCounts — tallies REAL probe.state across a set of connections
// (never a declared field). Feeds the /connections library page's summary
// stats.
// ---------------------------------------------------------------------------

export type ReadinessCounts = {
  available: number;
  notInstalled: number;
  misconfigured: number;
  total: number;
};

export function readinessCounts(entries: readonly ConnectionWire[]): ReadinessCounts {
  const counts: ReadinessCounts = { available: 0, notInstalled: 0, misconfigured: 0, total: entries.length };
  for (const e of entries) {
    if (e.probe.state === 'available') counts.available += 1;
    else if (e.probe.state === 'not-installed') counts.notInstalled += 1;
    else if (e.probe.state === 'misconfigured') counts.misconfigured += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// connectionBadges — derived from real fields only. An `available` entry
// carries no state badge. `curated` is orthogonal to probe state — an
// `available` mcp with curated capabilities still carries it (D8: the
// capability list must never hide its curated-not-verified provenance).
// ---------------------------------------------------------------------------

export type ConnectionBadge = 'not-installed' | 'misconfigured' | 'curated';

export function connectionBadges(entry: ConnectionWire): ConnectionBadge[] {
  const badges: ConnectionBadge[] = [];
  if (entry.probe.state === 'not-installed') badges.push('not-installed');
  if (entry.probe.state === 'misconfigured') badges.push('misconfigured');
  if (entry.kind === 'mcp' && entry.capabilitiesSource === 'curated') badges.push('curated');
  return badges;
}

// ---------------------------------------------------------------------------
// unreadyBoundConnections — the agent-builder's own readiness combinator,
// mirroring orchestrator/studio/connection-readiness.ts's
// `connectionsReadinessFor` exactly (same declared-data-fails-open guard: a
// bound id absent from the fetched connections list reads `not-installed`,
// never assumed available). Re-implemented client-side rather than imported
// because the server module lives under orchestrator/ — forge-ui never
// imports across that runtime boundary — and the agent builder already
// fetches the full connections list for its own page.
// ---------------------------------------------------------------------------

export type BoundConnectionRef = { id: string; kind: ConnectionKind };
export type UnreadyConnectionRef = { id: string; kind: ConnectionKind; state: ConnectionProbeState };

export function unreadyBoundConnections(
  bound: readonly BoundConnectionRef[],
  connections: readonly ConnectionWire[],
): UnreadyConnectionRef[] {
  const byId = new Map(connections.map((c) => [c.id, c] as const));
  const unready: UnreadyConnectionRef[] = [];
  for (const { id, kind } of bound) {
    const found = byId.get(id);
    const state: ConnectionProbeState = found?.probe.state ?? 'not-installed';
    if (state !== 'available') unready.push({ id, kind, state });
  }
  return unready;
}

// ---------------------------------------------------------------------------
// blockedRunMessage — the F3/D9 blocked-Run copy. MUST name every unready
// component and its state ("Agent not ready" alone is a documented failure
// of this AC). An empty list produces an empty string — the caller decides
// whether to render a blocked control at all.
// ---------------------------------------------------------------------------

export function blockedRunMessage(unready: readonly UnreadyConnectionRef[]): string {
  if (unready.length === 0) return '';
  const parts = unready.map((u) => `${u.kind} "${u.id}" (${u.state})`);
  return `Run blocked — not ready: ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// configVarStatus — D5: NAMES only, never a value. A REQUIRED var's
// set/unset status is derivable from the probe's `missingConfig` (required-
// and-unset NAMES, per connection-probe.ts's `computeMissingConfig`, which
// only ever inspects required vars). An OPTIONAL var's presence is never
// probed at all, so it reads 'unchecked' rather than a fabricated
// set/unset guess — stating the limit rather than hiding it (house
// convention, mirrors D15's "stated limit, in the module and on the
// surface").
// ---------------------------------------------------------------------------

export type ConfigVarStatus = 'set' | 'unset' | 'unchecked';

export function configVarStatus(configVar: ConnectionConfigVar, missingConfig: readonly string[]): ConfigVarStatus {
  if (!configVar.required) return 'unchecked';
  return missingConfig.includes(configVar.env) ? 'unset' : 'set';
}

// ---------------------------------------------------------------------------
// describeInstallOutcome — T2 ruling round 2, item 3c: a SUPPRESSED install
// result must NEVER be presented as success/installed. The input type is
// broader than connection-client.ts's `ConnectionInstallOutcome` (which only
// models the two `ok:true` transport variants) because a REAL failed install
// (`installed:false`, or a raw bridge response carrying `ok:false`) is a
// genuine third case this view must render distinctly — never as "installed".
// ---------------------------------------------------------------------------

export type InstallOutcomeInput = {
  ok: boolean;
  suppressed: boolean;
  wouldInstall?: { command: string; args: string[] };
  installed?: boolean;
  error?: string;
};

export type InstallOutcomeStatus = 'installed' | 'suppressed' | 'failed';

export type InstallOutcomeView = {
  status: InstallOutcomeStatus;
  label: string;
  wouldInstall?: { command: string; args: string[] };
};

export function describeInstallOutcome(outcome: InstallOutcomeInput): InstallOutcomeView {
  if (outcome.suppressed) {
    return {
      status: 'suppressed',
      label: 'Install suppressed — nothing was run (dry-bridge / no-spawn mode).',
      ...(outcome.wouldInstall !== undefined ? { wouldInstall: outcome.wouldInstall } : {}),
    };
  }
  if (!outcome.ok || outcome.installed === false) {
    return {
      status: 'failed',
      label: outcome.error ? `Install failed: ${outcome.error}` : 'Install failed.',
    };
  }
  return { status: 'installed', label: 'Installed.' };
}
