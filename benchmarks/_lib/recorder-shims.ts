/**
 * Bench-tempdir PATH shims for demo recording tools (VHS, Playwright via npx)
 * and `gh` CLI. Used by both the per-phase review-loop bench
 * (`benchmarks/review-loop/sdk.ts`) and the integration e2e bench
 * (`benchmarks/e2e/sdk.ts`).
 *
 * Why shims: real VHS needs ffmpeg + ttyd (extra system deps). Real Playwright
 * needs a 200 MB+ browser bundle. Real `gh` would open real GitHub PRs from
 * the bench. None of those belong in the bench's hot loop. The shims accept
 * the same argv as the real tools and produce valid stub artifacts (correct
 * magic bytes, padded above the size floor) or rejected calls (gh stub that
 * exits non-zero). The bench tests the *agent's workflow* — write tape,
 * invoke recorder, draft PR — not the rendering fidelity. Production installs
 * real VHS / Playwright; the orchestrator does NOT add these shims.
 *
 * The shims are tiny node scripts that write binary headers correctly using
 * Buffer literals — sh `printf` with `\x` escapes is non-portable across
 * /bin/sh implementations (dash silently drops them). Node is already a
 * dependency since forge runs on it.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * gh stub: defense-in-depth against an agent that ignores prompt rules and
 * tries to open a real PR. Always exits non-zero.
 */
export const GH_REJECT_SHIM_SCRIPT = `#!/bin/sh
echo "[bench] gh disabled — orchestrator owns gh pr create" >&2
exit 1
`;

export const VHS_SHIM_SCRIPT = `#!/usr/bin/env node
// vhs shim for forge bench. Writes a stub recording with valid magic bytes,
// >= 60 KB, in the cwd or -o location. Does not render.
// Usage: vhs <tape> [-o <output>]
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
let tape = '';
let out = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-o' || a === '--output') { out = argv[++i] ?? ''; continue; }
  if (a === '-t' || a === '--theme' || a === '-q' || a === '--quiet') {
    if (a !== '-q' && a !== '--quiet') i += 1;
    continue;
  }
  if (a.startsWith('-')) continue;
  if (!tape) tape = a;
}
if (!tape) { process.stderr.write('vhs shim: missing tape argument\\n'); process.exit(2); }
if (!out) out = path.join(process.cwd(), 'out.gif');
if (!path.isAbsolute(out)) out = path.resolve(process.cwd(), out);
fs.mkdirSync(path.dirname(out), { recursive: true });
const ext = out.toLowerCase();
let header;
if (ext.endsWith('.mp4') || ext.endsWith('.m4v')) {
  // ftyp box at offset 0; size=32, type='ftyp', major_brand='isom'
  header = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x20]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('isomiso2avc1mp41', 'ascii'),
  ]);
} else if (ext.endsWith('.webm')) {
  header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
} else {
  // default: gif
  header = Buffer.from('GIF89a', 'ascii');
}
const padding = Buffer.alloc(65536, 0xaa);
fs.writeFileSync(out, Buffer.concat([header, padding]));
process.stderr.write(\`[vhs shim] recorded \${tape} -> \${out}\\n\`);
process.exit(0);
`;

export const NPX_PLAYWRIGHT_SHIM_SCRIPT = `#!/usr/bin/env node
// npx shim for forge bench. Recognises Playwright invocations and emits a
// stub trace.zip in the agent's cwd; everything else exits non-zero (the
// bench has no other npx use case).
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
const isPlaywright = argv.some((a) => a.includes('playwright'));
if (!isPlaywright) {
  process.stderr.write('[npx shim] only playwright subcommands supported in bench\\n');
  process.exit(1);
}
// Default output path: <cwd>/recording.trace.zip
const out = path.resolve(process.cwd(), 'recording.trace.zip');
fs.mkdirSync(path.dirname(out), { recursive: true });
// PK\\x03\\x04 (zip local file header) + minimal padding to clear size floor.
const header = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
]);
const padding = Buffer.alloc(65536, 0xaa);
fs.writeFileSync(out, Buffer.concat([header, padding]));
process.stderr.write(\`[npx shim] playwright recording -> \${out}\\n\`);
process.exit(0);
`;

/**
 * Write the standard recorder shim set into `<binDir>`: `gh` (rejects),
 * `vhs` (stub mp4/webm/gif), `npx` (handles `playwright test`). Creates the
 * directory if it doesn't exist. Returns the absolute paths of the three
 * scripts in case the caller wants to reference them.
 */
export function writeRecorderShims(binDir: string): {
  ghStub: string;
  vhsShim: string;
  npxShim: string;
} {
  mkdirSync(binDir, { recursive: true });

  const ghStub = resolve(binDir, 'gh');
  writeFileSync(ghStub, GH_REJECT_SHIM_SCRIPT);
  chmodSync(ghStub, 0o755);

  const vhsShim = resolve(binDir, 'vhs');
  writeFileSync(vhsShim, VHS_SHIM_SCRIPT);
  chmodSync(vhsShim, 0o755);

  const npxShim = resolve(binDir, 'npx');
  writeFileSync(npxShim, NPX_PLAYWRIGHT_SHIM_SCRIPT);
  chmodSync(npxShim, 0o755);

  return { ghStub, vhsShim, npxShim };
}
