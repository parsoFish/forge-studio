/**
 * Client-side fetch helpers for the Studio templates-library bridge routes
 * (R3-06, WI-3). Mirrors the server-side shapes from
 * orchestrator/studio/template-library.ts verbatim — see that module's header
 * for the category/usedBy-derivation rules; nothing here re-derives a
 * category/usage fact, every field is carried through as-is from the bridge
 * response.
 *
 * Follows forge-ui/lib/skill-client.ts's precedent exactly: local structural
 * parsers, no cross-boundary import of orchestrator types, and a strict
 * refusal to coerce an unrecognised enum token (`category`/`previewKind`) to
 * a permissive default — an unrecognised token is a malformed response, not a
 * value to guess at, so it throws and the caller's `ok: false` error state
 * surfaces it (skill-client.ts's `parseSkillTrust` is the precedent).
 */

import { resolveBridgeUrl } from './bridge-client';

// ---------------------------------------------------------------------------
// Types mirroring server shapes (orchestrator/studio/template-library.ts)
// ---------------------------------------------------------------------------

export type TemplateCategory = 'demo-output' | 'planning' | 'project-scaffold';
export type TemplatePreviewKind = 'html' | 'video' | 'shots' | 'mock' | 'doc' | 'scaffold';

/** Names the real on-disk source a `usedBy` array was scanned from, and how
 *  many of that source were scanned — an empty `usedBy` always reads as
 *  "scanned N, found none", never "unknown". */
export type TemplateUsedByDerivation = {
  source: string;
  scanned: number;
};

export type TemplateLibraryEntry = {
  id: string;
  name: string;
  category: TemplateCategory;
  /** Derived server-side — absent only when the definition failed to parse
   *  (`error` set). */
  format?: string;
  provenance: string;
  definitionRef: string;
  /** Derived server-side, total-function output — absent only when the
   *  definition failed to parse. */
  previewKind?: TemplatePreviewKind;
  usedBy: string[]; // DERIVED — never re-derived client-side
  usedByDerivation: TemplateUsedByDerivation;
  /** Planning only — whether declaredProducer/declaredConsumer agree with the
   *  resolved flow-edge endpoints. Absent when nothing is declared. */
  endpointsVerified?: boolean;
  /** Verbatim frontmatter values — never normalized to a resolved form. */
  declaredProducer?: string;
  declaredConsumer?: string;
  description?: string;
  /** A malformed definition surfaces here — never dropped. */
  error?: string;
};

/**
 * An unrecognised category is a malformed response, not a value to guess at
 * — throws rather than defaulting, so every caller's existing try/catch turns
 * it into the page's explicit `ok: false` error state (mirrors
 * skill-client.ts's `parseSkillTrust`).
 */
function parseTemplateCategory(raw: unknown): TemplateCategory {
  if (raw === 'demo-output' || raw === 'planning' || raw === 'project-scaffold') return raw;
  throw new Error(`unrecognised template category: ${JSON.stringify(raw)}`);
}

/**
 * `previewKind` is legitimately absent (a malformed on-disk definition never
 * gets one), so `undefined` is a valid, honest result — but a PRESENT,
 * unrecognised token is still a malformed response and throws, never
 * silently coerced to some default kind.
 */
function parseTemplatePreviewKind(raw: unknown): TemplatePreviewKind | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'html' || raw === 'video' || raw === 'shots' || raw === 'mock' || raw === 'doc' || raw === 'scaffold') {
    return raw;
  }
  throw new Error(`unrecognised template previewKind: ${JSON.stringify(raw)}`);
}

function parseUsedByDerivation(raw: unknown): TemplateUsedByDerivation {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    source: typeof r['source'] === 'string' ? r['source'] : '',
    scanned: typeof r['scanned'] === 'number' ? r['scanned'] : 0,
  };
}

function parseTemplateLibraryEntry(raw: unknown): TemplateLibraryEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof r['id'] === 'string' ? r['id'] : '',
    name: typeof r['name'] === 'string' ? r['name'] : '',
    category: parseTemplateCategory(r['category']),
    format: typeof r['format'] === 'string' ? r['format'] : undefined,
    provenance: typeof r['provenance'] === 'string' ? r['provenance'] : '',
    definitionRef: typeof r['definitionRef'] === 'string' ? r['definitionRef'] : '',
    previewKind: parseTemplatePreviewKind(r['previewKind']),
    usedBy: Array.isArray(r['usedBy']) ? (r['usedBy'] as string[]) : [],
    usedByDerivation: parseUsedByDerivation(r['usedByDerivation']),
    endpointsVerified: typeof r['endpointsVerified'] === 'boolean' ? r['endpointsVerified'] : undefined,
    declaredProducer: typeof r['declaredProducer'] === 'string' ? r['declaredProducer'] : undefined,
    declaredConsumer: typeof r['declaredConsumer'] === 'string' ? r['declaredConsumer'] : undefined,
    description: typeof r['description'] === 'string' ? r['description'] : undefined,
    error: typeof r['error'] === 'string' ? r['error'] : undefined,
  };
}

/** Fetch the template library (planning + demo-output + project-scaffold
 *  union). Distinguishes a reachable-but-empty library from an unreachable
 *  bridge (`ok: false`) — the caller must never render the two the same way
 *  (house rule: no silent fallback to an empty list that looks like "no
 *  templates"). A response carrying an entry with an unrecognised
 *  `category`/`previewKind` token is treated the same way — `ok: false` —
 *  rather than silently coercing it. */
export async function fetchTemplateLibrary(): Promise<{ ok: boolean; templates: TemplateLibraryEntry[]; error?: string }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, templates: [], error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}/api/studio/templates`);
    const data = (await res.json().catch(() => ({}))) as { templates?: unknown[]; error?: string };
    if (!res.ok) return { ok: false, templates: [], error: data.error ?? `HTTP ${res.status}` };
    const templates = Array.isArray(data.templates) ? data.templates.map(parseTemplateLibraryEntry) : [];
    return { ok: true, templates };
  } catch (err) {
    return { ok: false, templates: [], error: String(err) };
  }
}

export type TemplatePackageFile = { path: string; body: string };

export type TemplateDetail = TemplateLibraryEntry & { files: TemplatePackageFile[] };

function parseTemplatePackageFiles(raw: unknown): TemplatePackageFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => {
    const ff = (f ?? {}) as Record<string, unknown>;
    return {
      path: typeof ff['path'] === 'string' ? ff['path'] : '',
      body: typeof ff['body'] === 'string' ? ff['body'] : '',
    };
  });
}

function parseTemplateDetail(raw: unknown): TemplateDetail {
  const entry = parseTemplateLibraryEntry(raw);
  const r = (raw ?? {}) as Record<string, unknown>;
  return { ...entry, files: parseTemplatePackageFiles(r['files']) };
}

/** Fetch a single template's detail (entry fields + a files package). The
 *  `status` is surfaced so the caller can tell a genuine 404 (unknown id)
 *  apart from a reachable-but-erroring bridge — never conflated. A response
 *  carrying an unrecognised `category`/`previewKind` token is treated as a
 *  parse failure — `ok: false` — never coerced to a token. */
export async function fetchTemplate(
  id: string,
): Promise<{ ok: boolean; status?: number; detail?: TemplateDetail; error?: string }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}/api/studio/templates/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as { error?: string })?.error;
      return { ok: false, status: res.status, error: err ?? `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, detail: parseTemplateDetail(data) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
