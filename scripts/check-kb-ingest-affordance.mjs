#!/usr/bin/env node
/**
 * check-kb-ingest-affordance.mjs — no-ingest-affordance RATCHET (operator
 * decision 3, 2026-08-03 — docs/decisions/010-brain-first.md line 22,
 * docs/roadmaps/R1-contract-componentry.md lines ~213-227: "Explicit
 * negative AC (decision 3): no ingest affordance anywhere in creation or
 * maintenance ... grep-level assert no UI route/action triggers ingest").
 *
 * Ingest stays reflection-only. This script enforces that at grep level
 * across the real repository:
 *
 *   1. No forge-ui `data-action="..."` value names ingest.
 *   2. No bridge KB route (cli/*.ts, excluding *.test.ts) has an
 *      `op === 'ingest'` / `case 'ingest'` dispatch arm.
 *   3. The literal strings `reflector-ingest` / `DEFAULT_KB_INGEST` appear
 *      ONLY in the descriptor-default definition/re-export
 *      (orchestrator/studio/kb-descriptor.ts, orchestrator/studio/
 *      registry.ts) and the reflection-path builtin invocation
 *      (orchestrator/kb-health.ts) — never in a dispatch arm or a UI
 *      action.
 *
 * This is a pure structural ratchet (same "prove-or-warn, one actionable
 * line per failure" model as check-request-path-sinks.mjs) — no baseline
 * file, since the invariant is "zero, forever", not a count that only ever
 * shrinks. The check function is injectable-root so a test can point it at
 * a synthetic fixture tree instead of the real repo (see the companion
 * scripts/check-kb-ingest-affordance.test.ts, which keeps its own inline
 * copy of this logic to prove the contract from first principles before
 * trusting this script's copy against the real tree).
 *
 * Usage:
 *   node scripts/check-kb-ingest-affordance.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Directories walked for forge-ui UI-action affordances.
const UI_SCAN_DIRS = ['forge-ui/app', 'forge-ui/components', 'forge-ui/lib'];
// Directories walked for bridge KB-route dispatch code.
const BRIDGE_SCAN_DIRS = ['cli'];
// Files where DEFAULT_KB_INGEST / 'reflector-ingest' legitimately appear —
// the descriptor default (+ its re-export) and the reflection builtin.
export const ALLOWED_INGEST_FILES = new Set([
  'orchestrator/studio/kb-descriptor.ts',
  'orchestrator/studio/registry.ts',
  'orchestrator/kb-health.ts',
]);

function isTestFile(p) {
  return /\.test\.(ts|tsx|mjs|js)$/.test(p);
}

function walk(dirAbs, exts, skip) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out; // dir doesn't exist in this tree — not an error, just nothing to scan
  }
  for (const e of entries) {
    const full = join(dirAbs, e.name);
    if (skip(full)) continue;
    if (e.isDirectory()) {
      out.push(...walk(full, exts, skip));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const GLOBAL_SKIP = (p) =>
  p.includes(`${join('node_modules')}`) || p.includes(`${join('.git')}`) ||
  p.includes(`${join('brain')}`) || p.includes(`${join('mockups')}`) ||
  p.includes(`${join('demos')}`) || isTestFile(p);

/**
 * Scan `root` for the no-ingest-affordance invariant. Returns a list of
 * human-readable violation strings; empty = clean.
 */
export function checkNoIngestAffordance(root = FORGE_ROOT) {
  const violations = [];

  // 1. forge-ui: no data-action="...ingest..." (case-insensitive).
  for (const dir of UI_SCAN_DIRS) {
    const files = walk(join(root, dir), ['.ts', '.tsx'], GLOBAL_SKIP);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const re = /data-action=["']([^"']*)["']/g;
      let m;
      while ((m = re.exec(text))) {
        if (m[1].toLowerCase().includes('ingest')) {
          violations.push(`${relative(root, file)}: data-action="${m[1]}" is a UI ingest affordance (forbidden — operator decision 3)`);
        }
      }
    }
  }

  // 2. bridge KB routes: no op-dispatch arm named 'ingest'.
  for (const dir of BRIDGE_SCAN_DIRS) {
    const files = walk(join(root, dir), ['.ts'], GLOBAL_SKIP);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/\bop\s*===\s*['"]ingest['"]/.test(text) || /\bcase\s+['"]ingest['"]/.test(text)) {
        violations.push(`${relative(root, file)}: bridge route dispatches op === 'ingest' (forbidden — operator decision 3)`);
      }
    }
  }

  // 3. reflector-ingest / DEFAULT_KB_INGEST literal must only appear in the
  //    allowed descriptor-default / reflection-builtin files.
  const allFiles = walk(root, ['.ts', '.tsx'], GLOBAL_SKIP);
  for (const file of allFiles) {
    const relPath = relative(root, file).split('\\').join('/');
    if (ALLOWED_INGEST_FILES.has(relPath)) continue;
    const text = readFileSync(file, 'utf8');
    if (text.includes('reflector-ingest') || text.includes('DEFAULT_KB_INGEST')) {
      violations.push(`${relPath}: references reflector-ingest/DEFAULT_KB_INGEST outside the allowed descriptor-default/reflection files`);
    }
  }

  return violations;
}

/**
 * Run the check. Root is injectable so tests can point this at a temp
 * fixture tree instead of the real repo. Returns a process exit code;
 * never calls process.exit itself.
 */
export function runCheck({ root = FORGE_ROOT } = {}) {
  const violations = checkNoIngestAffordance(root);
  if (violations.length) {
    console.error(`check-kb-ingest-affordance: FAIL (${violations.length} ingest affordance${violations.length === 1 ? '' : 's'} found — forbidden, operator decision 3)`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    console.error('');
    console.error('Ingest stays reflection-only (docs/decisions/010-brain-first.md). Remove the UI action / bridge dispatch arm / stray reference, or move it into the allowed descriptor-default files.');
    return 1;
  }
  console.log('check-kb-ingest-affordance: PASS — no ingest affordance in forge-ui or the bridge KB routes');
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(runCheck());
}
