/**
 * check-adr-links ratchet — proof the gate BITES.
 *
 * Spec §4 "Docs": `decisions/` is append-only, with **two-way `supersedes`
 * links** on the amended records. A reader who lands on the superseded ADR
 * must learn that from the ADR itself, not from having read the newer one.
 *
 * Scope: a DECLARATION is a `**Supersedes:**` / `**Amends:**` /
 * `**Superseded-by:**` / `**Amended-by:**` field carrying a link to another
 * ADR file. Prose that merely says "extends ADR 011" is not a machine
 * declaration and is deliberately not policed — the rule is about links.
 *
 * These tests run the REAL checker as a subprocess against fabricated
 * decision trees, plus the real repo for the one invariant that is true today
 * and must stay true (every declared reference resolves to a file).
 *
 * RUN: node --test --experimental-strip-types scripts/check-adr-links.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-adr-links.mjs');

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, root], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** A decisions/ tree: `adrs` maps `NNN-slug.md` to its body. */
function fixture(adrs: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'adr-links-'));
  mkdirSync(join(root, 'docs/decisions'), { recursive: true });
  for (const [name, body] of Object.entries(adrs)) {
    writeFileSync(join(root, 'docs/decisions', name), body, 'utf8');
  }
  return root;
}

test('a one-way Supersedes FAILS, naming both ADRs and the line the converse belongs on', () => {
  const root = fixture({
    '040-successor.md': '# ADR 040\n\n- **Supersedes:** [ADR 026](./026-predecessor.md) — the newer loop.\n',
    '026-predecessor.md': '# ADR 026\n\nThe older decision.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a one-way link must fail, got:\n${out}`);
  assert.match(out, /026/, 'the violation must name the ADR missing its back-link');
  assert.match(out, /040/, 'the violation must name the ADR that declared the relation');
  assert.match(out, /Superseded-by/, 'the violation must name the field to add');
});

test('a one-way Amends FAILS the same way, asking for Amended-by', () => {
  const root = fixture({
    '048-amender.md': '# ADR 048\n\n**Amends:** [ADR 038](./038-amended.md) (the scope split).\n',
    '038-amended.md': '# ADR 038\n\nThe amended decision.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a one-way amend must fail, got:\n${out}`);
  assert.match(out, /Amended-by/, 'an Amends relation asks for Amended-by, not Superseded-by');
});

test('a symmetric pair PASSES', () => {
  const root = fixture({
    '040-successor.md': '# ADR 040\n\n- **Supersedes:** [ADR 026](./026-predecessor.md) — the newer loop.\n',
    '026-predecessor.md': '# ADR 026\n\n**Superseded-by:** [ADR 040](./040-successor.md)\n\nThe older decision.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `a symmetric pair must pass, got:\n${out}`);
  assert.match(out, /1 linked pair/, 'the PASS line states how many pairs it checked');
});

test('a declared reference to an ADR that does not exist FAILS, naming the dangling target', () => {
  const root = fixture({
    '040-successor.md': '# ADR 040\n\n- **Supersedes:** [ADR 099](./099-ghost.md) — a record that was never written.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a dangling reference must fail, got:\n${out}`);
  assert.match(out, /099-ghost\.md/, 'the violation must name the missing file');
});

test('prose that mentions an ADR without linking it is NOT a declaration', () => {
  const root = fixture({
    '019-older.md': '# ADR 019\n\n- **Supersedes / amends:** extends ADR 011 (unattended scheduler), ADR 012 (crash recovery).\n',
    '011-scheduler.md': '# ADR 011\n\nThe scheduler.\n',
    '012-recovery.md': '# ADR 012\n\nCrash recovery.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `an unlinked prose mention must not demand a back-link, got:\n${out}`);
  assert.match(out, /0 linked pairs/, 'no pair is counted from prose');
});

test('a bold **supersedes** inside body prose is not a declaration field', () => {
  const root = fixture({
    '025-observability.md': '# ADR 025\n\nThe running total **supersedes** the in-flight estimate — so no double-count.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `a bold word mid-sentence is not a field, got:\n${out}`);
});

test('a combined "Supersedes / amends" field accepts EITHER converse', () => {
  // 043 and 044 both declare `**Supersedes / amends:** [ADR 042]`, but one
  // supersedes a ruling and the other amends one. Forcing a single converse
  // would make the back-link say something the record does not mean, so the
  // combined field accepts whichever converse the target's author writes.
  const amended = fixture({
    '043-generic.md': '# ADR 043\n\n- **Supersedes / amends:** [ADR 042](./042-cap.md) — one ruling.\n',
    '042-cap.md': '# ADR 042\n\n**Amended-by:** [ADR 043](./043-generic.md)\n',
  });
  const a = run(amended);
  rmSync(amended, { recursive: true, force: true });
  assert.equal(a.code, 0, `Amended-by must satisfy a combined field, got:\n${a.out}`);

  const superseded = fixture({
    '046-layout.md': '# ADR 046\n\n- **Supersedes / amends:** [ADR 042](./042-cap.md) — the cap.\n',
    '042-cap.md': '# ADR 042\n\n**Superseded-by:** [ADR 046](./046-layout.md)\n',
  });
  const b = run(superseded);
  rmSync(superseded, { recursive: true, force: true });
  assert.equal(b.code, 0, `Superseded-by must satisfy a combined field, got:\n${b.out}`);
});

test('a combined field with NEITHER converse still FAILS, naming both acceptable fields', () => {
  const root = fixture({
    '043-generic.md': '# ADR 043\n\n- **Supersedes / amends:** [ADR 042](./042-cap.md) — one ruling.\n',
    '042-cap.md': '# ADR 042\n\nNo back-link at all.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a missing converse must fail, got:\n${out}`);
  assert.match(out, /Superseded-by/, 'both acceptable fields are named so the author can pick the true one');
  assert.match(out, /Amended-by/, 'both acceptable fields are named so the author can pick the true one');
});

test('only the FIRST ADR link on a field line is the declared target', () => {
  // ADR 026's real line: "**amends [ADR 019]** — … Builds on [ADR 021] … and
  // [ADR 031]". The amend target is 019; the other two are references. A
  // checker that demanded back-links from all three would make 021 and 031
  // claim a relation their authors never declared.
  const root = fixture({
    '026-successor.md':
      '# ADR 026\n\n- **Supersedes / amends:** **amends [ADR 019](./019-target.md)** — retires the marker. Builds on [ADR 021](./021-other.md) and [ADR 031](./031-third.md).\n',
    '019-target.md': '# ADR 019\n\n**Amended-by:** [ADR 026](./026-successor.md)\n',
    '021-other.md': '# ADR 021\n\nNo back-link — none is owed.\n',
    '031-third.md': '# ADR 031\n\nNo back-link — none is owed.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `only the declared target owes a back-link, got:\n${out}`);
  assert.match(out, /1 linked pair/, 'exactly one pair, not three');
});

test('a link introduced by a non-declaring phrase declares nothing', () => {
  // ADR 044's real line amends a BRAIN THEME, and its only ADR link is
  // "Operates inside [ADR 042]'s boundaries" — a boundary reference, not an
  // amendment of 042.
  const root = fixture({
    '044-memo.md':
      "# ADR 044\n\n- **Supersedes / amends:** Amends the posture recorded in `brain/forge-dev/themes/x.md` (a corollary, not a reversal). Operates inside [ADR 042](./042-cap.md)'s boundaries.\n",
    '042-cap.md': '# ADR 042\n\nNo back-link — none is owed.\n',
  });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `"Operates inside" is not a declaration, got:\n${out}`);
  assert.match(out, /0 linked pairs/, 'no pair is declared by a boundary reference');
});

test('every declared reference in the real repo resolves to a file on disk', () => {
  // The pair COUNT on the live tree moves as M6-B adds back-links, so it is
  // not asserted here (§15.192/.195). Resolvability is the invariant that is
  // true today and must survive every edit.
  const { out } = run(ROOT);
  assert.match(out, /linked pairs?/, `the checker did not run:\n${out}`);
  assert.doesNotMatch(out, /does not exist on disk/, `an ADR declares a reference to a missing file:\n${out}`);
});
