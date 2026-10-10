/**
 * served-file.ts — the two facts about serving a file over HTTP that a route
 * must not guess for itself: its content-type by extension (ONE table), and
 * what a `Range` request header asks for.
 *
 * forge-mfv5.1.29: `GET /api/artifact/...` answered every extension but
 * `.html` with `text/plain`, so a captured `.webm` could not play. The table
 * lives here, once; the bridge's `contentTypeFor` and the demo data-URI
 * builder both read it.
 */
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';

import { guardedFile } from './path-guard.ts';

const TEXT = 'charset=utf-8';

/** Lower-case extension (with dot) -> content-type. The one table. */
export const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.md': `text/plain; ${TEXT}`, // displayed inline by a raw link (Studio's artifact page); text/markdown downloads
  '.html': `text/html; ${TEXT}`,
  '.txt': `text/plain; ${TEXT}`,
  '.log': `text/plain; ${TEXT}`,
};

/** The content-type for `filename` by its (case-insensitive) extension, or
 *  `undefined` when the table has no row — the caller owns the fallback. */
export function contentTypeByExtension(filename: string): string | undefined {
  const ext = extname(filename).toLowerCase();
  return Object.hasOwn(CONTENT_TYPE_BY_EXTENSION, ext) ? CONTENT_TYPE_BY_EXTENSION[ext] : undefined;
}

/** What a `Range` header asks for, resolved against the file size. */
export type ByteRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

const SINGLE_RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/**
 * Resolve a `Range` header against a file of `size` bytes (RFC 9110 §14).
 * Honours exactly ONE `bytes=a-b` / `bytes=a-` / `bytes=-n` range -> `partial`
 * (inclusive, end clamped to the last byte); a start past EOF or a zero-length
 * suffix -> `unsatisfiable` (the caller sends 416). Everything else — absent,
 * multi-range, malformed, a non-`bytes` unit, a reversed `b < a` — is IGNORED
 * -> `full` (a server may ignore Range; the client gets the whole 200 body).
 */
export function resolveByteRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return { kind: 'full' };
  const m = SINGLE_RANGE_RE.exec(header.trim());
  if (m === null) return { kind: 'full' };
  const [, first = '', last = ''] = m;
  if (first === '' && last === '') return { kind: 'full' };
  if (first === '') {
    const n = Number(last);
    if (n === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(first);
  if (last !== '' && Number(last) < start) return { kind: 'full' };
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: Math.min(last === '' ? size - 1 : Number(last), size - 1) };
}

/**
 * Guard `<root>/<segments...>` (leaf included) and hand back a BYTE reader over
 * the regular file it names, or `null` if rejected / absent / not a regular
 * file (the same no-oracle collapse as `guardedReadFile`). For serving binary
 * artifacts (video, images): `guardedReadFile` decodes to a string, which
 * corrupts bytes, and would hold a multi-MB file in memory. `open()` streams
 * the whole file, or the inclusive `{start, end}` slice — never more than asked.
 */
export function guardedByteReader(
  root: string,
  segments: readonly string[],
): { size: number; open: (range?: { start: number; end: number }) => Readable } | null {
  const p = guardedFile(root, segments, 'read');
  if (p === null) return null;
  try {
    const st = statSync(p);
    if (!st.isFile()) return null;
    return { size: st.size, open: (range) => createReadStream(p, range) };
  } catch {
    return null;
  }
}
