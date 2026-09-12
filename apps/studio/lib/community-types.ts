/**
 * The community browser's WIRE VOCABULARY — every type and constant the
 * `/community` surface reads off the bridge, and nothing else.
 *
 * Extracted from `community-client.ts` (M6-D / ruling 477), which had grown
 * past its `check-file-size` ceiling and could not carry another field. The
 * split is along the file's own existing seam: declarations here, the parsers
 * that REFUSE malformed payloads there. `community-client.ts` re-exports all
 * of this verbatim, so no import site moved and no consumer knows the file
 * exists.
 *
 * These shapes mirror the server's (`packages/library/bridge-studio-community-wire.ts`,
 * `packages/library/studio/community-index.ts`). A field added on one side is
 * added on the other in the same change, or the client's own parsers reject
 * the payload — which is the point: `hub`/`signals`/`probeState` are
 * legitimately nullable, but an ABSENT key is a malformed response, never
 * silently the same as an explicit null.
 */

import type { ConnectionProbeResult } from './connection-client.ts';

// ---------------------------------------------------------------------------
// Types mirroring server shapes (orchestrator/studio/community-index.ts,
// packages/library/bridge-studio-community.ts)
// ---------------------------------------------------------------------------

export const COMMUNITY_KINDS = ['skill', 'hook', 'mcp', 'tool'] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const COMMUNITY_INSTALL_STATES = ['not-installed', 'draft-pending-approval', 'needs-review', 'installed', 'present-unmanaged'] as const;
export type CommunityInstallState = (typeof COMMUNITY_INSTALL_STATES)[number];

export const COMMUNITY_PROBE_STATES = ['not-installed', 'available', 'misconfigured'] as const;
export type CommunityProbeState = (typeof COMMUNITY_PROBE_STATES)[number];

export type CommunityHub = {
  id: string;
  name: string;
  url: string;
  kinds: string; // raw curated string, never parsed into an array
};

export type CommunityHubWithCount = CommunityHub & { itemCount: number; reason?: string };

export type CommunitySignals = {
  stars: string;
  attributedTo: string;
  /** Parsed NUMERIC star count alongside the display `stars` string above —
   *  null when the curated display string names a different unit or carries
   *  no figure at all; never fabricated (W6-CR-2). */
  starsNumeric: number | null;
};

export type CommunityItem = {
  id: string;
  kind: CommunityKind;
  name: string;
  desc: string;
  /** W8-B5 (community-05) — the registry row's own category ("planning",
   *  "memory", "review", …), mirrored from `CommunityItemWire`. It exists so
   *  the browse search can match the word the registry itself files rows
   *  under. `null` for an item with no registry row at all (a vendored
   *  package, a catalog connection): an honest absence, never an invented
   *  string and deliberately never `''`. */
  category: string | null;
  upstream: string;
  hub: CommunityHub | null;
  signals: CommunitySignals | null;
  vendored: boolean;
  /** M6-D / ruling 477 — the canonical repository URL forge would fetch this
   *  row's package from, or `null` when there is nothing it can fetch. Derived
   *  server-side by `toWireItem`, from the same grammar the install route
   *  uses, so the page can never offer an install the route would refuse, and
   *  never names a repository other than the one the fetch would reach. */
  upstreamFetchableAs: string | null;
  installState: CommunityInstallState;
  probeState: CommunityProbeState | null;
  origin: string;
  /** ISO date this item was last verified against upstream — null until a
   *  real refresh pass has run for it, or for an item with no registry row
   *  at all (a vendored package / connection). NEVER render a date for a
   *  null fetchedAt — the honest "seed — never verified" state instead
   *  (W6-CR-2). */
  fetchedAt: string | null;
  /** Provenance of the currently-recorded data — "seed" for a
   *  registry-sourced item, "local" for a vendored package/connection with
   *  no registry row. Always a real, non-blank string. */
  fetchedBy: string;
  /** ISO date the upstream project last published a change, per the
   *  registry's own curated fact — null when unknown or for an item with no
   *  registry row; never fabricated. */
  upstreamUpdatedAt: string | null;
};

export type CommunityFile = { path: string; body: string };

export const HOOK_SCAN_CATEGORIES = ['network-egress', 'env-read', 'file-read', 'obfuscation'] as const;
export type HookScanCategory = (typeof HOOK_SCAN_CATEGORIES)[number];

export const HOOK_FINDING_SEVERITIES = ['critical', 'info'] as const;
export type HookFindingSeverity = (typeof HOOK_FINDING_SEVERITIES)[number];

export const HOOK_SCAN_VERDICTS = ['blocked', 'findings', 'clean'] as const;
export type HookScanVerdict = (typeof HOOK_SCAN_VERDICTS)[number];

export type HookScanFinding = {
  category: HookScanCategory;
  severity: HookFindingSeverity;
  message: string;
  match: string;
  declared: boolean;
};

export type HookScanReport = {
  verdict: HookScanVerdict;
  findings: HookScanFinding[];
};

export type CommunityConnectionInstallMethod =
  | { method: 'system-provided' }
  | { method: 'npm'; package: string; version: string }
  | { method: 'external'; upstream: string };

export type CommunityConnectionConfigVar = { env: string; required: boolean; purpose: string };
export type CommunityConnectionCapability = { name: string; summary: string };

export type CommunitySkillDetail = CommunityItem & { files: CommunityFile[] };
export type CommunityHookDetail = CommunityItem & { files: CommunityFile[]; scan: HookScanReport };
export type CommunityConnectionDetail = CommunityItem & {
  install: CommunityConnectionInstallMethod;
  config: CommunityConnectionConfigVar[];
  probe: ConnectionProbeResult;
  /** Present iff the catalog mcp entry declares them — never a fabricated
   *  empty array for a tool entry or an mcp entry that declares none. */
  capabilities?: CommunityConnectionCapability[];
  capabilitiesSource?: 'curated';
};
export type CommunityItemDetail = CommunitySkillDetail | CommunityHookDetail | CommunityConnectionDetail;

/** M6-D / ruling 478 — a row a declared hub publishes that this registry does
 *  not carry. A PROPOSAL: the page offers it and the operator adds it through
 *  the add-row door, which stays the only write path (`hubs.yaml`'s D10 —
 *  forge does not crawl on its own, so a discovery is a suggestion rather than
 *  a change). `sourceUrl` is the repository the INSTALLER will fetch from, not
 *  a decoration: a discovered row is installable by construction. */
export type DiscoveredRow = { id: string; sourceUrl: string; path: string };

/** What one declared hub did on a refresh. `reason`/`message` carry the
 *  reader's OWN refusal rather than a second wording of it, so the chip says
 *  what the reader said. */
export type HubOutcomeRow = {
  hubId: string;
  discovered: number;
  partial?: boolean;
  reason?: string;
  message?: string;
};

