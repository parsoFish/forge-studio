/**
 * D-46 / dev/UI-CONSTRAINTS.md §3 — "a page carries at most five top-level
 * sections". A top-level section is an element carrying
 * `data-page-section="<name>"`: a titled group that wraps the route's
 * existing `data-section` blocks (it never replaces them — the stories read
 * those). One row per route that has been brought inside its budget
 * (forge-nk1y.37, R56); each row names the groups in order.
 *
 * KILLS: a route that stacks its blocks loose again (no groups → count 0
 * ≠ the declared list), a sixth group added past the cap, or a group renamed
 * without this table (and the plan's shape paragraph) moving with it.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUDIO = join(__dirname, '..', '..');

type Row = { route: string; file: string; max: number; groups: string[] };

const ROWS: Row[] = [
  {
    route: '/projects/[id] (editor tab)',
    file: 'app/projects/[id]/page.tsx',
    max: 5,
    groups: ['brief', 'demo', 'skills-knowledge', 'cycle-ledger', 'contract'],
  },
];

function pageSections(file: string): string[] {
  const src = readFileSync(join(STUDIO, file), 'utf8');
  return [...src.matchAll(/data-page-section="([a-z-]+)"/g)].map((m) => m[1]);
}

for (const row of ROWS) {
  test(`${row.route}: at most ${row.max} top-level sections, declared in order`, () => {
    const found = pageSections(row.file);
    expect(found.length).toBeLessThanOrEqual(row.max);
    expect(found).toEqual(row.groups);
  });
}
