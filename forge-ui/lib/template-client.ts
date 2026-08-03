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
 *
 * The same refusal applies to every REQUIRED structural field — `id`, `name`,
 * `category`, `provenance`, `definitionRef`, `usedBy`, `usedByDerivation`.
 * The server (orchestrator/studio/template-library.ts) always populates all
 * seven, even on a per-entry parse failure (surfaced via the sibling `error`
 * field) — so a missing or wrong-typed one here can only mean the bridge
 * response itself is malformed. `usedByDerivation` exists so an empty
 * `usedBy` reads as "scanned N sources, found none" rather than "unknown"
 * (D3 in the server module); inventing `{source:'',scanned:0}` for a MISSING
 * derivation, or coercing a non-array `usedBy` to `[]`, would silently
 * manufacture exactly the "unknown" reading the derivation exists to rule
 * out — so both throw instead. Every throw is caught by the fetch
 * functions' own parse-stage try/catch and reported as `ok: false` with a
 * `"malformed bridge response: ..."`-prefixed error, kept distinct from a
 * `"bridge unreachable: ..."`-prefixed error for an actual transport failure
 * (the `fetch()` call itself throwing) — a page can tell the two apart.
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

/** True for a non-null, non-array object — the shape every parser below
 *  requires before it will even look at a field. Rejects `null`, arrays,
 *  strings, numbers, and `undefined` alike; none of those is a record. */
function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** A required string field: present and a string, or throw. No caller of
 *  this may substitute `''` for a missing/wrong-typed value — that would be
 *  exactly the silent-default this module refuses to do. */
function requireString(r: Record<string, unknown>, field: string): string {
  const v = r[field];
  if (typeof v !== 'string') {
    throw new Error(`missing or invalid "${field}": expected a string, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** `usedBy` absent, or present but not an array, is a malformed response —
 *  never coerced to `[]` (see the module header: that would fabricate the
 *  exact "unknown" reading `usedByDerivation` exists to rule out). */
function parseUsedBy(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error(`missing or invalid "usedBy": expected an array, got ${JSON.stringify(raw)}`);
  }
  return raw as string[];
}

/** `usedByDerivation` absent, not an object, or with a non-string `source` /
 *  non-number `scanned`, is a malformed response — never defaulted to
 *  `{source:'',scanned:0}` (an invented "scanned 0" derivation is worse than
 *  no derivation: it looks like a real, honest answer). */
function parseUsedByDerivation(raw: unknown): TemplateUsedByDerivation {
  if (!isPlainObject(raw)) {
    throw new Error(`missing or invalid "usedByDerivation": expected an object, got ${JSON.stringify(raw)}`);
  }
  const source = raw['source'];
  const scanned = raw['scanned'];
  if (typeof source !== 'string') {
    throw new Error(`missing or invalid "usedByDerivation.source": expected a string, got ${JSON.stringify(source)}`);
  }
  if (typeof scanned !== 'number') {
    throw new Error(`missing or invalid "usedByDerivation.scanned": expected a number, got ${JSON.stringify(scanned)}`);
  }
  return { source, scanned };
}

function parseTemplateLibraryEntry(raw: unknown): TemplateLibraryEntry {
  if (!isPlainObject(raw)) {
    throw new Error(`malformed template entry: expected an object, got ${JSON.stringify(raw)}`);
  }
  const r = raw;
  return {
    id: requireString(r, 'id'),
    name: requireString(r, 'name'),
    category: parseTemplateCategory(r['category']),
    format: typeof r['format'] === 'string' ? r['format'] : undefined,
    provenance: requireString(r, 'provenance'),
    definitionRef: requireString(r, 'definitionRef'),
    previewKind: parseTemplatePreviewKind(r['previewKind']),
    usedBy: parseUsedBy(r['usedBy']),
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
 *  `category`/`previewKind` token, or missing/malformed structural fields
 *  (`id`/`name`/`provenance`/`definitionRef`/`usedBy`/`usedByDerivation`), or
 *  a top-level `templates` that is absent or not an array, is treated the
 *  same way — `ok: false` — rather than silently coercing it. A genuinely
 *  empty library (`{templates: []}`) is the one legitimate empty and still
 *  returns `ok: true, templates: []`. */
export async function fetchTemplateLibrary(): Promise<{ ok: boolean; templates: TemplateLibraryEntry[]; error?: string }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, templates: [], error: 'no bridge configured' };

  let res: Response;
  try {
    res = await fetch(`${base}/api/studio/templates`);
  } catch (err) {
    return { ok: false, templates: [], error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      const errMsg = isPlainObject(data) && typeof data['error'] === 'string' ? data['error'] : undefined;
      return { ok: false, templates: [], error: errMsg ?? `HTTP ${res.status}` };
    }
    if (!isPlainObject(data)) {
      return {
        ok: false,
        templates: [],
        error: `malformed bridge response: expected a JSON object, got ${JSON.stringify(data)}`,
      };
    }
    if (!Array.isArray(data['templates'])) {
      return {
        ok: false,
        templates: [],
        error: `malformed bridge response: "templates" ${'templates' in data ? 'is not an array' : 'is missing'}`,
      };
    }
    const templates = (data['templates'] as unknown[]).map(parseTemplateLibraryEntry);
    return { ok: true, templates };
  } catch (err) {
    return { ok: false, templates: [], error: `malformed bridge response: ${String(err)}` };
  }
}

export type TemplatePackageFile = { path: string; body: string };

export type TemplateDetail = TemplateLibraryEntry & { files: TemplatePackageFile[] };

/** `files` absent, or present but not an array, is a malformed response —
 *  never coerced to `[]` (the bridge always sends it for a valid detail
 *  response, so a missing/wrong-typed "files" can only mean the response
 *  itself is malformed — same rule as `usedBy` above). Each element must be
 *  a plain object with string `path`/`body` fields; never defaulted to `''`,
 *  which would fabricate a file path/body the bridge never sent. A
 *  genuinely empty package (`files: []`) is the one legitimate empty and
 *  passes through unchanged. */
function parseTemplatePackageFiles(raw: unknown): TemplatePackageFile[] {
  if (!Array.isArray(raw)) {
    throw new Error(`missing or invalid "files": expected an array, got ${JSON.stringify(raw)}`);
  }
  return raw.map((f) => {
    if (!isPlainObject(f)) {
      throw new Error(`malformed template package file: expected an object, got ${JSON.stringify(f)}`);
    }
    return {
      path: requireString(f, 'path'),
      body: requireString(f, 'body'),
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

  let res: Response;
  try {
    res = await fetch(`${base}/api/studio/templates/${encodeURIComponent(id)}`);
  } catch (err) {
    return { ok: false, error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      const errMsg = isPlainObject(data) && typeof data['error'] === 'string' ? data['error'] : undefined;
      return { ok: false, status: res.status, error: errMsg ?? `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, detail: parseTemplateDetail(data) };
  } catch (err) {
    return { ok: false, status: res.status, error: `malformed bridge response: ${String(err)}` };
  }
}
