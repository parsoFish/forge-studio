/**
 * Client-side fetch helpers for the Studio skills-library bridge routes
 * (R3-01-F3/F4). Mirrors the server-side shapes from
 * orchestrator/studio/skill-library.ts verbatim — see that module's header
 * for the trust vocabulary and the union/derivation rules; nothing here
 * re-derives a trust/usage fact, every field is carried through as-is from
 * the bridge response.
 *
 * Split out of studio-client.ts (MAJOR 2, adversarial review round): this
 * block had zero interdependency with the rest of that file. Re-declares its
 * own tiny POST helper rather than importing studio-client's private
 * `studioPost` — the point of the split is a clean module boundary, not a
 * re-export shim back into the file it was extracted from.
 */

import { bridgeFetch } from './bridge-client';

// ---------------------------------------------------------------------------
// Types mirroring server shapes
// ---------------------------------------------------------------------------

export type SkillSource = 'local' | 'community';
export type SkillTrust = 'ready' | 'draft' | 'needs-review';

export type SkillProvenance = {
  source: string;
  upstreamRef?: string;
  contentHash: string;
  installedAt: string;
  catalogId?: string;
};

export type SkillLibraryEntry = {
  id: string;
  name: string;
  description?: string;
  source: SkillSource;
  installed: boolean;
  trust: SkillTrust;
  paletteVisible: boolean;
  usedBy: string[]; // DERIVED agent slugs — never re-derived client-side
  provenance: SkillProvenance | null;
  category?: string;
  tier?: string;
  stars?: string;
  hub?: string;
  error?: string; // malformed on-disk skill — surfaced, never dropped
  /** W7-B3 — browse-only registry reference with no local bytes (see
   *  orchestrator/studio/skill-library.ts's field doc). */
  reference?: boolean;
};

function parseSkillProvenance(raw: unknown): SkillProvenance | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Partial<SkillProvenance>;
  if (typeof p.source !== 'string' || typeof p.contentHash !== 'string' || typeof p.installedAt !== 'string') {
    return null;
  }
  return {
    source: p.source,
    contentHash: p.contentHash,
    installedAt: p.installedAt,
    ...(typeof p.upstreamRef === 'string' ? { upstreamRef: p.upstreamRef } : {}),
    ...(typeof p.catalogId === 'string' ? { catalogId: p.catalogId } : {}),
  };
}

/**
 * An unrecognised trust token is a malformed response, not a value to guess
 * at (MINOR fix, adversarial-review round). The prior version defaulted any
 * unrecognised/missing token to `'ready'` — the most permissive label — which
 * is exactly the "silent fallback toward reassurance" the house rules forbid.
 * Throws rather than inventing a fourth token or silently downgrading; every
 * caller below already wraps its parse in a try/catch that turns a thrown
 * error into the page's existing explicit `ok: false` error state, so an
 * unknown trust is surfaced as a failure, never a guessed value.
 */
function parseSkillTrust(raw: unknown): SkillTrust {
  if (raw === 'ready' || raw === 'draft' || raw === 'needs-review') return raw;
  throw new Error(`unrecognised skill trust value: ${JSON.stringify(raw)}`);
}

function parseSkillLibraryEntry(raw: unknown): SkillLibraryEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof r['id'] === 'string' ? r['id'] : '',
    name: typeof r['name'] === 'string' ? r['name'] : '',
    description: typeof r['description'] === 'string' ? r['description'] : undefined,
    source: r['source'] === 'community' ? 'community' : 'local',
    installed: r['installed'] === true,
    trust: parseSkillTrust(r['trust']),
    paletteVisible: r['paletteVisible'] === true,
    usedBy: Array.isArray(r['usedBy']) ? (r['usedBy'] as string[]) : [],
    provenance: parseSkillProvenance(r['provenance']),
    category: typeof r['category'] === 'string' ? r['category'] : undefined,
    tier: typeof r['tier'] === 'string' ? r['tier'] : undefined,
    stars: typeof r['stars'] === 'string' ? r['stars'] : undefined,
    hub: typeof r['hub'] === 'string' ? r['hub'] : undefined,
    error: typeof r['error'] === 'string' ? r['error'] : undefined,
    ...(r['reference'] === true ? { reference: true } : {}),
  };
}

/** Fetch the skills library (local + community union). Distinguishes a
 *  reachable-but-empty library from an unreachable bridge (`ok: false`) —
 *  the caller must never render the two the same way (house rule: no silent
 *  fallback to an empty list that looks like "no skills"). A response
 *  carrying an entry with an unrecognised `trust` token is treated the same
 *  way — `ok: false` — rather than silently coercing it. */
export async function fetchSkillLibrary(): Promise<{ ok: boolean; skills: SkillLibraryEntry[]; error?: string }> {
  try {
    const res = await bridgeFetch(`/api/studio/skills`);
    const data = (await res.json().catch(() => ({}))) as { skills?: unknown[]; error?: string };
    if (!res.ok) return { ok: false, skills: [], error: data.error ?? `HTTP ${res.status}` };
    const skills = Array.isArray(data.skills) ? data.skills.map(parseSkillLibraryEntry) : [];
    return { ok: true, skills };
  } catch (err) {
    return { ok: false, skills: [], error: String(err) };
  }
}

export type SkillPackageFile = { path: string; body: string };

export type SkillScanReport = {
  quarantinedKeys: string[];
  executableFiles: string[];
  fileCount: number;
  totalBytes: number;
  body: string;
};

export type SkillDetail = {
  id: string;
  name: string;
  description?: string;
  trust: SkillTrust;
  paletteVisible: boolean;
  files: SkillPackageFile[];
  reason?: string;
  scan?: SkillScanReport;
  // Additive fields (WI-3 — the bridge detail route was extended to carry
  // these so the detail page never has to re-derive a trust/usage fact):
  source: SkillSource;
  usedBy: string[];
  provenance: SkillProvenance | null;
};

function parseSkillPackageFiles(raw: unknown): SkillPackageFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => {
    const ff = (f ?? {}) as Record<string, unknown>;
    return {
      path: typeof ff['path'] === 'string' ? ff['path'] : '',
      body: typeof ff['body'] === 'string' ? ff['body'] : '',
    };
  });
}

function parseSkillScanReport(raw: unknown): SkillScanReport | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  return {
    quarantinedKeys: Array.isArray(s['quarantinedKeys']) ? (s['quarantinedKeys'] as string[]) : [],
    executableFiles: Array.isArray(s['executableFiles']) ? (s['executableFiles'] as string[]) : [],
    fileCount: typeof s['fileCount'] === 'number' ? s['fileCount'] : 0,
    totalBytes: typeof s['totalBytes'] === 'number' ? s['totalBytes'] : 0,
    body: typeof s['body'] === 'string' ? s['body'] : '',
  };
}

function parseSkillDetail(raw: unknown): SkillDetail {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof r['id'] === 'string' ? r['id'] : '',
    name: typeof r['name'] === 'string' ? r['name'] : '',
    description: typeof r['description'] === 'string' ? r['description'] : undefined,
    trust: parseSkillTrust(r['trust']),
    paletteVisible: r['paletteVisible'] === true,
    files: parseSkillPackageFiles(r['files']),
    reason: typeof r['reason'] === 'string' ? r['reason'] : undefined,
    scan: parseSkillScanReport(r['scan']),
    source: r['source'] === 'community' ? 'community' : 'local',
    usedBy: Array.isArray(r['usedBy']) ? (r['usedBy'] as string[]) : [],
    provenance: parseSkillProvenance(r['provenance']),
  };
}

/** Fetch a single skill's detail (package + trust + scan-if-draft). The
 *  `status` is surfaced so the caller can tell a genuine 404 (unknown id)
 *  apart from a reachable-but-erroring bridge — never conflated. A response
 *  carrying an unrecognised `trust` token is treated as a parse failure —
 *  `ok: false` — never coerced to a token. */
export async function fetchSkill(
  id: string,
): Promise<{ ok: boolean; status?: number; detail?: SkillDetail; error?: string }> {
  try {
    const res = await bridgeFetch(`/api/studio/skills/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as { error?: string })?.error;
      return { ok: false, status: res.status, error: err ?? `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, detail: parseSkillDetail(data) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function skillClientPost(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await bridgeFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: typeof data.ok === 'boolean' ? data.ok : true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Approve a draft skill install (D4: never restores `runtime`/`allowed-tools`). */
export async function approveSkill(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await skillClientPost(`/api/studio/skills/${encodeURIComponent(id)}/approve`, {});
  return { ok: r.ok, error: r.error };
}

async function skillClientSend(
  method: 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await bridgeFetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: typeof data.ok === 'boolean' ? data.ok : true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** W7-B4 (library-05) — edit a skill's display name / description / body.
 *  The id (directory) never changes; editing an installed skill honestly
 *  drops it to needs-review via the existing hash-drift pipeline. */
export async function updateSkill(
  id: string,
  input: Partial<{ name: string; description: string; body: string }>,
): Promise<{ ok: boolean; error?: string }> {
  return skillClientSend('PUT', `/api/studio/skills/${encodeURIComponent(id)}`, input);
}

/** W7-B4 (library-05) — delete a skill package. The bridge refuses (409,
 *  naming them) while any agent still composes it. */
export async function deleteSkill(id: string): Promise<{ ok: boolean; error?: string }> {
  return skillClientSend('DELETE', `/api/studio/skills/${encodeURIComponent(id)}`);
}
