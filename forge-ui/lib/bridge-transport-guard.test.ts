/**
 * W7-FIX-A1 (A1-05) — ONE transport for every bridge call in Studio.
 *
 * `bridgeFetch` (lib/bridge-client.ts) is the ONLY place that (a) runs the
 * one-shot port correction against `/api/forge-config` and (b) reports a
 * transport failure to the bridge-status store (`notifyTransportFailure` →
 * the app-shell banner + immediate health probe). Before this fix, 14 client
 * modules still did `const base = await resolveBridgeUrl(); fetch(`${base}…`)`
 * — under `--bridge-port` their first wrong guess was never corrected until
 * some OTHER module happened to self-correct the shared cache, and their
 * failures never reached the banner (docs/forge-ui-dom-and-harness.md claimed
 * otherwise — crosscut-26 as generalised by W7-A1's PR body).
 *
 * This is a static scan over the REAL source tree (lib/, components/, app/;
 * non-test files) — the guard the sweep found missing ("nothing stops a
 * 17th copy"). Two rules:
 *   1. NO source file other than `lib/bridge-client.ts` calls global `fetch(`
 *      (bridgeFetch is the only sanctioned way to reach the bridge; Studio
 *      talks to nothing else over HTTP).
 *   2. `resolveBridgeUrl` may be imported ONLY by the explicit allowlist
 *      below — modules that need the base URL for a NON-fetch purpose (media
 *      `<video src>` / an `<iframe src>` served by the bridge). A new
 *      importer must justify itself here.
 * Comments are stripped before matching so prose mentions don't count.
 *
 * Kills: any new `resolveBridgeUrl()+fetch()` copy; a module quietly reaching
 * for global fetch with its own URL logic.
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-transport-guard.test.ts
 */
import { test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['lib', 'components', 'app'];
const TRANSPORT = 'lib/bridge-client.ts';

/** Files that may import `resolveBridgeUrl` for a documented non-fetch use. */
const RESOLVE_URL_ALLOWLIST: Record<string, string> = {
  'components/DemoComparison.tsx': 'builds `<video src>` URLs for artifact media served by the bridge (no fetch)',
  'app/artifact/page.tsx': 'builds the sandboxed PLAN.html `<iframe src>` URL (its fetches ride bridgeFetch)',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '.next') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

export function scanBridgeTransport(root: string = ROOT): { rawFetch: string[]; resolveUrlImporters: string[] } {
  const rawFetch: string[] = [];
  const resolveUrlImporters: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).split('\\').join('/');
      if (rel === TRANSPORT) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      // a bare `fetch(` call — not `bridgeFetch(`, `.fetch(`, `fetchX(` etc.
      if (/(?<![\w.$])fetch\s*\(/.test(code)) rawFetch.push(rel);
      if (/import\s*(?:type\s*)?\{[^}]*\bresolveBridgeUrl\b[^}]*\}\s*from\s*['"](?:\.\.?\/|@\/lib\/)[^'"]*bridge-client(?:\.ts)?['"]/.test(code)) resolveUrlImporters.push(rel);
    }
  }
  return { rawFetch: rawFetch.sort(), resolveUrlImporters: resolveUrlImporters.sort() };
}

test('rule 1: no source file outside lib/bridge-client.ts calls global fetch( — every bridge call rides bridgeFetch', () => {
  const { rawFetch } = scanBridgeTransport();
  expect(rawFetch).toEqual([]);
});

test('rule 2: resolveBridgeUrl is imported only by the documented non-fetch allowlist (and every allowlisted file still exists)', () => {
  const { resolveUrlImporters } = scanBridgeTransport();
  const allow = Object.keys(RESOLVE_URL_ALLOWLIST).sort();
  const unexpected = resolveUrlImporters.filter((f) => !allow.includes(f));
  const stale = allow.filter((f) => !resolveUrlImporters.includes(f));
  expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
});

test('positive control: the scanner sees a raw fetch and a resolveBridgeUrl import when they exist (bridge-client.ts itself has both)', () => {
  const code = stripComments(readFileSync(join(ROOT, TRANSPORT), 'utf8'));
  expect(/(?<![\w.$])fetch\s*\(/.test(code)).toBe(true);
  // the transport module DEFINES resolveBridgeUrl; the import regex is exercised on a synthetic line
  const synthetic = "import { fetchCycles, resolveBridgeUrl } from '@/lib/bridge-client';\nconst base = await resolveBridgeUrl();\nconst res = await fetch(`${base}/api/x`);";
  expect(/import\s*(?:type\s*)?\{[^}]*\bresolveBridgeUrl\b[^}]*\}\s*from\s*['"](?:\.\.?\/|@\/lib\/)[^'"]*bridge-client(?:\.ts)?['"]/.test(synthetic)).toBe(true);
  expect(/(?<![\w.$])fetch\s*\(/.test(synthetic)).toBe(true);
  // and does NOT flag the sanctioned transport call
  expect(/(?<![\w.$])fetch\s*\(/.test("const res = await bridgeFetch('/api/x');")).toBe(false);
});
