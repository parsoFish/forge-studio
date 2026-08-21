'use client';

/**
 * document-title — per-route browser-tab titles (W7-C3, crosscut-06).
 *
 * app/layout.tsx exports one static `metadata.title = 'forge'` and the app is
 * almost entirely client components, so no route-level Next metadata exists —
 * every tab read the identical "forge". This module is the ONE derivation:
 * the shared shells (`StudioPage`, `StudioArchitectShell`) call
 * `useDocumentTitle` with their title (so every shell-based route gets a
 * distinct tab for free), and the non-shell detail pages call it directly
 * with their most-specific parts first ("gitpulse · Projects · forge").
 */
import { useEffect } from 'react';

/** Most-specific part first; blank parts dropped; always ends in "forge". */
export function formatDocumentTitle(parts: readonly string[]): string {
  const clean = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return [...clean, 'forge'].join(' · ');
}

/**
 * Set document.title for the lifetime of the page. No cleanup/restore on
 * unmount — the next route's own hook overwrites it, and restoring "forge"
 * between client-side navigations would just flash the useless global title.
 */
export function useDocumentTitle(...parts: Array<string | null | undefined>): void {
  const title = formatDocumentTitle(parts.filter((p): p is string => typeof p === 'string'));
  useEffect(() => {
    document.title = title;
  }, [title]);
}
