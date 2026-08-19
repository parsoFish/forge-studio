/**
 * W7-A4 — ONE initiative-title derivation (findings agents-05, flows-08,
 * flows-26, projects-10); W7-FIX-A4 (W7A4-01) — the derivation has a REAL
 * producer.
 *
 * Rule: an initiative's display title comes from manifest METADATA — the
 * frontmatter `title:` — which every manifest PRODUCER now writes
 * (`buildManifest` in architect-runner.ts from `DraftInitiative.title`;
 * `mintTriggeredInitiative` from the trigger + flow). Only when a manifest
 * carries no frontmatter title (hand-authored / pre-W7 manifests) does the
 * derivation fall back to the body's first level-1 `# ` heading — NEVER a
 * `##`+ section heading — and only then to the `initiative_id`. Every
 * surface (run rails, HISTORY ledgers, run-detail heading, Home ledger,
 * project roadmap cards, architect session page) reads the same value, so
 * one initiative has one name across Studio.
 *
 * Wrong implementations these pins kill:
 *   - `extractTitle` in run-model.ts scraping `/^#+ (.+)/m` — every run whose
 *     manifest opens with "## Summary" is titled "Summary" (agents-05);
 *   - `deriveInitiativeTitle` in bridge-studio.ts scraping the first
 *     non-boilerplate heading — 52 betterado roadmap cards titled
 *     "Background" / "Constraints" / "Acceptance criteria" (projects-10);
 *   - two independent derivations that disagree (flows-26);
 *   - a derivation with NO producer: `buildManifest` dropping
 *     `DraftInitiative.title` on the floor so every architect-originated
 *     initiative renders as its raw INIT id (W7A4-01).
 *
 * RUN: node --test --experimental-strip-types orchestrator/initiative-title.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initiativeTitle, parseManifest, serializeManifest } from './manifest.ts';
import { aggregateRun } from './run-model.ts';
import { buildManifest, type ArchitectStatus, type DraftInitiative } from './architect-runner.ts';
import { mintTriggeredInitiative } from './mint-triggered-initiative.ts';
import type { FlowRunRequest } from './flow-run-requests.ts';

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

test('initiativeTitle: frontmatter title wins; otherwise the initiative id — a `##` section heading is NEVER consulted', () => {
  const summaryFirst = parseManifest(manifestText({ body: '## Summary\n\nAdd a thing.\n\n## Canonical vocabulary\n\nDetails.\n' }));
  assert.equal(initiativeTitle(summaryFirst), INIT_ID);

  const titled = parseManifest(manifestText({ title: 'Canonical vocabulary for all 31 matrices', body: '## Summary\n\nx\n' }));
  assert.equal(initiativeTitle(titled), 'Canonical vocabulary for all 31 matrices');

  const titledOverH1 = parseManifest(manifestText({ title: 'Frontmatter wins', body: '# A real H1 heading\n\nBody.\n' }));
  assert.equal(initiativeTitle(titledOverH1), 'Frontmatter wins', 'the frontmatter title outranks any body heading');

  const blankTitle = parseManifest(manifestText({ title: '   ', body: '## Summary\n\nx\n' }));
  assert.equal(initiativeTitle(blankTitle), INIT_ID, 'a blank title is absent (parseManifest drops it) → id');
});

test('W7A4-01: with NO frontmatter title, the FIRST level-1 `# ` heading is the documented fallback — never `##`, never a code-fence comment', () => {
  const h1First = parseManifest(manifestText({ body: '# A real H1 heading\n\nBody.\n\n## Summary\n\nx\n' }));
  assert.equal(initiativeTitle(h1First), 'A real H1 heading');

  const h1AfterSection = parseManifest(manifestText({ body: '## Summary\n\nx\n\n# Late H1\n\ny\n' }));
  assert.equal(initiativeTitle(h1AfterSection), 'Late H1', 'the first `# ` heading anywhere in the body, not only line 1');

  const fenced = parseManifest(manifestText({ body: '## Summary\n\n```bash\n# install deps\nnpm ci\n```\n\n## Goal\n\nShip.\n' }));
  assert.equal(initiativeTitle(fenced), INIT_ID, 'a `# ` shell comment inside a fenced block is not a heading');

  const sectionsOnly = parseManifest(manifestText({ body: '## Goal\n\nShip.\n\n### Acceptance criteria\n\n- x\n' }));
  assert.equal(initiativeTitle(sectionsOnly), INIT_ID, 'section headings never name an initiative');

  const idHeading = parseManifest(manifestText({ body: `# ${INIT_ID}\n\nBody.\n` }));
  assert.equal(initiativeTitle(idHeading), INIT_ID);
});

// ---------------------------------------------------------------------------
// W7A4-01 — the REAL producers write `title:` (not a hand-written fixture).
// ---------------------------------------------------------------------------

const ARCHITECT_STATUS: ArchitectStatus = {
  session_id: '2026-08-19T00-00-00-abcd1234',
  project: 'test-project',
  project_repo_path: '/tmp/test',
  phase: 'drafting',
  round: 1,
  idea: 'Add a version flag.',
  updated_at: '2026-08-19T00:00:00.000Z',
};

test('W7A4-01: buildManifest (the architect producer) threads DraftInitiative.title into frontmatter `title:` — round-trips through serialize/parse and initiativeTitle()', () => {
  const draft: DraftInitiative = {
    slug: 'add-version-flag',
    title: 'Add a --version flag to the CLI',
    iteration_budget: 5,
    cost_budget_usd: 5,
    body: '## Summary\n\nPrint the version.\n\n## Acceptance criteria\n\n- `--version` prints it.\n',
  };
  const m = buildManifest(draft, ARCHITECT_STATUS, '2026-08-19', '2026-08-19T00:00:00.000Z');
  assert.equal(m.initiative_id, 'INIT-2026-08-19-add-version-flag');
  assert.equal(m.title, 'Add a --version flag to the CLI', 'the manifest object carries the human title');

  const text = serializeManifest(m);
  assert.match(text, /^title: .*Add a --version flag to the CLI/m, `serialized frontmatter must carry title:, got:\n${text.split('---')[1]}`);
  const parsed = parseManifest(text);
  assert.equal(initiativeTitle(parsed), 'Add a --version flag to the CLI', 'the display derivation reads the producer\'s title, not the INIT id');
  assert.notEqual(initiativeTitle(parsed), parsed.initiative_id);

  // A blank/whitespace draft title is NOT a title (parseManifest drops it) —
  // the fallback chain still applies rather than serializing `title: "  "`.
  const blank = buildManifest({ ...draft, title: '   ' }, ARCHITECT_STATUS, '2026-08-19', '2026-08-19T00:00:00.000Z');
  assert.equal(blank.title, undefined, 'a blank draft title is absent, never a whitespace string');
});

test('W7A4-01: mintTriggeredInitiative (the trigger producer) writes a human `title:` naming the flow + trigger, never the raw INIT id', () => {
  const root = mkdtempSync(join(tmpdir(), 'initiative-title-mint-'));
  try {
    const flowDir = join(root, 'studio', 'flows', 'tick');
    mkdirSync(flowDir, { recursive: true });
    writeFileSync(join(flowDir, 'flow.yaml'), [
      'id: tick', 'name: Nightly tick', 'version: 1', 'goal: A trigger-originated flow test fixture.',
      'project: someproj', 'kb: null', 'costCeilingUsd: 10', 'origin: seed',
      'nodes:', '  - { id: dev, agent: developer-ralph }', 'edges: []', 'triggers: []', '',
    ].join('\n'));
    mkdirSync(join(root, 'projects', 'someproj'), { recursive: true });
    const req: FlowRunRequest = {
      target: { kind: 'flow', ref: 'tick' },
      origin: 'cron',
      triggeredBy: 'cron:nightly',
      createdAt: new Date().toISOString(),
    };
    const result = mintTriggeredInitiative(req, { forgeRoot: root, queueRoot: join(root, '_queue'), logsRoot: join(root, '_logs') });
    assert.equal(result.status, 'minted', JSON.stringify(result));
    const written = parseManifest(readFileSync(join(root, '_queue', 'pending', `${result.initiativeId}.md`), 'utf8'));
    assert.ok(written.title && written.title.trim().length > 0, 'a triggered manifest carries a title');
    assert.notEqual(initiativeTitle(written), written.initiative_id, 'the display title is not the raw INIT id');
    assert.match(initiativeTitle(written), /tick/, 'the title names the target flow');
    assert.match(initiativeTitle(written), /cron/, 'the title names the trigger origin');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('W7A4-01 (FIX): a structured-output draft with a missing or non-string title does not crash drafting — the manifest carries no title and the documented fallback chain applies', () => {
  // `DraftInitiative` is the SHAPE the architect skill is asked for, not a
  // shape the runner enforces: `runStructured` casts raw model output. A draft
  // that omits `title` (or sends null) must degrade to the fallback chain, not
  // throw a TypeError out of the `.map` and fail the whole draft step.
  const untitled = {
    slug: 'add-version-flag',
    iteration_budget: 5,
    cost_budget_usd: 5,
    body: '# Add a --version flag\n\nPrint the version.\n',
  } as unknown as DraftInitiative;
  const missing = buildManifest(untitled, ARCHITECT_STATUS, '2026-08-19', '2026-08-19T00:00:00.000Z');
  assert.equal(missing.title, undefined, 'no title key when the draft has none');
  assert.equal(missing.initiative_id, 'INIT-2026-08-19-add-version-flag');
  assert.equal(initiativeTitle(missing), 'Add a --version flag', 'the H1 fallback names it');
  assert.doesNotMatch(serializeManifest(missing), /^title:/m, 'never serialize an empty title:');

  for (const bad of [null, 42, { en: 'x' }, ['x']]) {
    const m = buildManifest(
      { ...untitled, title: bad } as unknown as DraftInitiative,
      ARCHITECT_STATUS,
      '2026-08-19',
      '2026-08-19T00:00:00.000Z',
    );
    assert.equal(m.title, undefined, `a non-string title (${JSON.stringify(bad)}) is absent, not a crash`);
    assert.equal(initiativeTitle(m), 'Add a --version flag');
  }
});
