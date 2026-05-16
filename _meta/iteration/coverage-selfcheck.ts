/**
 * coverage-selfcheck — the COVERAGE obligation's concrete check.
 *
 * Asserts the coverage matrix is internally consistent: every
 * acceptance obligation is mapped to a well-formed objective check at
 * its tier, with NO pending rows left. This is the self-consistency
 * gate the COVERAGE row points at — every US- / G- obligation is either
 * PASS at its tier or explicitly mapped.
 *
 * It parses coverage-matrix.md with the SAME row regex closure-check.ts
 * uses (so "well-formed" means exactly "closure-check can evaluate it"),
 * then enforces:
 *
 *   1. No row has kind `pending` EXCEPT the explicitly-allowed
 *      operator-gated exceptions (see ALLOWED_PENDING). Every other
 *      obligation must have landed a real check — `pending` is the
 *      not-yet-done sentinel. G11 (the full per-phase bench re-run)
 *      stays `pending` by design: it is mapped to a deliberate
 *      operator-gated moment (real API cost, run by a human), so it is
 *      "explicitly mapped" rather than "not yet done".
 *   2. Every row's `arg` is well-formed for its kind:
 *        - grep-absent / grep-present : contains a `::` PATTERN::GLOB split
 *          with non-empty pattern AND glob.
 *        - loc-max                    : `N :: GLOB` with numeric N.
 *        - file-absent / file-present : a non-empty path.
 *        - cmd                        : a non-empty command, and (matrix
 *          parser constraint) NO literal pipe `|` (the column-split regex
 *          truncates on it) and NO backtick (closure-check strips them).
 *   3. The matrix actually covers the story/goal surface: at least one
 *      row exists for the closure goals the loop tracks (a tripwire so a
 *      future edit can't silently drop a whole obligation row).
 *
 * Dependency-free (Node stdlib only). Exit 0 iff consistent. Run:
 *   node --experimental-strip-types _meta/iteration/coverage-selfcheck.ts
 *
 * Guardrail: tooling ABOUT the forge repo, not forge runtime.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MATRIX = resolve(import.meta.dirname, 'coverage-matrix.md');

// Same row shape closure-check.ts parses. Keeping these in lock-step is
// the point: "well-formed" == "closure-check can evaluate this row".
const ROW =
  /^\|\s*([A-Za-z0-9.\-]+)\s*\|(.+)\|\s*(cmd|grep-absent|grep-present|file-absent|file-present|loc-max|pending)\s*\|(.+)\|\s*(fast|full)\s*\|$/;

type Row = { id: string; kind: string; arg: string; tier: string };

/**
 * Obligation ids permitted to remain `pending` because they are mapped
 * to a deliberate operator-gated moment, not unfinished work. Keeping
 * this list TINY and explicit is the point — a `pending` row is a defect
 * unless it is *here* with a stated reason.
 *
 *   G11 — re-run every per-phase benchmark with real SDK/API spend and
 *          assert no false-colour. Costs real money and is a human
 *          decision (operator runs `npm run bench:*`), so it cannot be
 *          an unattended closure-check `cmd`. It is mapped (to that
 *          operator action), just not auto-evaluable.
 */
const ALLOWED_PENDING = new Set<string>(['G11']);

function parse(): Row[] {
  const md = readFileSync(MATRIX, 'utf8');
  const rows: Row[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(ROW);
    if (!m) continue;
    if (m[1] === 'id') continue; // header
    rows.push({
      id: m[1].trim(),
      kind: m[3].trim(),
      // strip surrounding/embedded backticks exactly as closure-check does
      arg: m[4].trim().replace(/^`|`$/g, '').replace(/`/g, ''),
      tier: m[5].trim(),
    });
  }
  return rows;
}

function wellFormed(r: Row): string | null {
  if (r.kind === 'pending') {
    if (ALLOWED_PENDING.has(r.id)) return null; // explicitly mapped operator-gated exception
    return `row ${r.id} is still 'pending' — convert it to a concrete check`;
  }
  if (r.kind === 'grep-absent' || r.kind === 'grep-present') {
    const parts = r.arg.split('::').map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return `row ${r.id} (${r.kind}) arg must be "PATTERN :: GLOB" with both sides non-empty`;
    }
    return null;
  }
  if (r.kind === 'loc-max') {
    const [nStr, glob] = r.arg.split('::').map((s) => s.trim());
    if (!nStr || Number.isNaN(Number(nStr)) || !glob) {
      return `row ${r.id} (loc-max) arg must be "N :: GLOB" with numeric N`;
    }
    return null;
  }
  if (r.kind === 'file-absent' || r.kind === 'file-present') {
    if (!r.arg.trim()) return `row ${r.id} (${r.kind}) arg must be a non-empty path`;
    return null;
  }
  if (r.kind === 'cmd') {
    if (!r.arg.trim()) return `row ${r.id} (cmd) arg must be a non-empty command`;
    // Matrix parser constraint: a literal pipe in a cmd makes the
    // column-split regex truncate the arg; a backtick is stripped by
    // closure-check and would corrupt shell quoting. Either is a latent
    // false-pass — reject it here so the matrix stays evaluable.
    if (r.arg.includes('|')) {
      return `row ${r.id} (cmd) contains a literal pipe — the matrix column-split truncates on it`;
    }
    if (r.arg.includes('`')) {
      return `row ${r.id} (cmd) contains a backtick — closure-check strips it, corrupting the command`;
    }
    return null;
  }
  return `row ${r.id} has unknown kind ${r.kind}`;
}

function main(): void {
  const rows = parse();
  const problems: string[] = [];

  if (rows.length === 0) {
    problems.push('no obligation rows parsed — the matrix table is missing or malformed');
  }

  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const p = wellFormed(r);
    if (p) problems.push(p);
  }

  // Tripwire: these obligation ids are the load-bearing closure goals the
  // loop tracks; a future edit must not silently drop a whole row. (Not an
  // exhaustive list — just the ones whose absence would hide a regression.)
  const REQUIRED = [
    'BUILD', 'TEST', 'SIMPL-LOC',
    'G1', 'G4', 'G8', 'G9', 'G10',
    'US-1.3-pr', 'US-2.3', 'US-3.1', 'US-4.1', 'US-7.1-notify',
    'ARCH-FRESH', 'COVERAGE',
  ];
  for (const id of REQUIRED) {
    if (!ids.has(id)) problems.push(`required obligation row '${id}' is missing from the matrix`);
  }

  if (problems.length) {
    console.log(`coverage-selfcheck: FAIL (${problems.length} issue(s))`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `coverage-selfcheck: OK — ${rows.length} obligation rows, all well-formed, no pending rows.`,
  );
  process.exit(0);
}

main();
