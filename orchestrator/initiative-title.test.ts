/**
 * W7-A4 — ONE initiative-title derivation (findings agents-05, flows-08,
 * flows-26, projects-10).
 *
 * Rule: an initiative's display title comes from manifest METADATA — the
 * frontmatter `title:` when the author supplied one, else the
 * `initiative_id` — never from a markdown heading in the body. Every surface
 * (run rails, HISTORY ledgers, run-detail heading, Home ledger, project
 * roadmap cards, architect session page) reads the same value, so one
 * initiative has one name across Studio.
 *
 * Wrong implementations these pins kill:
 *   - `extractTitle` in run-model.ts scraping `/^#+ (.+)/m` — every run whose
 *     manifest opens with "## Summary" is titled "Summary" (agents-05);
 *   - `deriveInitiativeTitle` in bridge-studio.ts scraping the first
 *     non-boilerplate heading — 52 betterado roadmap cards titled
 *     "Background" / "Constraints" / "Acceptance criteria" (projects-10);
 *   - two independent derivations that disagree (flows-26).
 *
 * RUN: node --test --experimental-strip-types orchestrator/initiative-title.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initiativeTitle, parseManifest } from './manifest.ts';
import { aggregateRun } from './run-model.ts';

const INIT_ID = 'INIT-2026-08-14-betterado-gap-registry';

function manifestText(opts: { title?: string; body: string }): string {
  const titleLine = opts.title !== undefined ? `title: ${JSON.stringify(opts.title)}\n` : '';
  return (
    '---\n' +
    `initiative_id: ${INIT_ID}\n` +
    'project: test-project\n' +
    'project_repo_path: /tmp/test\n' +
    "created_at: '2026-01-01T00:00:00Z'\n" +
    'iteration_budget: 10\n' +
    'cost_budget_usd: 5\n' +
    'phase: pending\n' +
    'origin: architect\n' +
    'flow_id: forge-develop\n' +
    titleLine +
    '---\n\n' +
    opts.body
  );
}

test('initiativeTitle: frontmatter title wins; otherwise the initiative id — the body heading is NEVER consulted', () => {
  const summaryFirst = parseManifest(manifestText({ body: '## Summary\n\nAdd a thing.\n\n## Canonical vocabulary\n\nDetails.\n' }));
  assert.equal(initiativeTitle(summaryFirst), INIT_ID);

  const h1First = parseManifest(manifestText({ body: '# A real H1 heading\n\nBody.\n' }));
  assert.equal(initiativeTitle(h1First), INIT_ID, 'even an H1 is body prose, not metadata');

  const titled = parseManifest(manifestText({ title: 'Canonical vocabulary for all 31 matrices', body: '## Summary\n\nx\n' }));
  assert.equal(initiativeTitle(titled), 'Canonical vocabulary for all 31 matrices');

  const blankTitle = parseManifest(manifestText({ title: '   ', body: '## Summary\n\nx\n' }));
  assert.equal(initiativeTitle(blankTitle), INIT_ID, 'a blank title is absent (parseManifest drops it) → id');
});

test('run-model: run.initiative is the SAME derivation — id when no title, title when present, never "Summary"', () => {
  const root = mkdtempSync(join(tmpdir(), 'initiative-title-'));
  try {
    const queueDir = join(root, '_queue', 'pending');
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(join(root, '_logs'), { recursive: true });

    const untitledPath = join(queueDir, `${INIT_ID}.md`);
    writeFileSync(untitledPath, manifestText({ body: '## Summary\n\nAdd a thing.\n\n## Goal\n\nShip.\n' }));
    const untitled = aggregateRun({ root, queueState: 'pending', manifestPath: untitledPath, nowMs: Date.now() });
    assert.equal(untitled.initiative, INIT_ID, `got ${JSON.stringify(untitled.initiative)}`);
    assert.notEqual(untitled.initiative, 'Summary');

    const titledPath = join(queueDir, 'INIT-2026-08-14-titled.md');
    writeFileSync(
      titledPath,
      manifestText({ title: 'Betterado gap registry', body: '## Summary\n\nx\n' }).replace(`initiative_id: ${INIT_ID}`, 'initiative_id: INIT-2026-08-14-titled'),
    );
    const titled = aggregateRun({ root, queueState: 'pending', manifestPath: titledPath, nowMs: Date.now() });
    assert.equal(titled.initiative, 'Betterado gap registry');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
