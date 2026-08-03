import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { FORGE_ROOT, caption } from '../lib/journey-fixtures.mjs';

// ── R3-06 helpers: real, disk-derived cross-checks ──────────────────────────
// These independently recompute what orchestrator/studio/template-library.ts
// derives server-side (read directly off studio/flows/*/flow.yaml and the
// scaffold directory tree, no TS import from this .mjs harness) — mirroring
// skills.mjs's realSkillUsage precedent: the point of every beat that calls
// these is a genuine cross-check against reality, not a re-read of whatever
// the product's own response already claims.

const EDGE_ARROW = '→';

/** `resolved = node.agent ?? 'gate:' + node.id` — mirrors
 *  template-library.ts's resolveNodeLabel. */
function resolveNodeLabel(node) {
  return node.agent ?? `gate:${node.id}`;
}

/** Independently recomputes a planning artifact template's derived `usedBy`
 *  labels by reading every studio/flows/*\/flow.yaml directly and matching
 *  edges whose `artifact` equals `artifactId` — the same derivation
 *  template-library.ts's buildFlowEdgeIndex/usedByLabelsFor perform
 *  server-side, recomputed here from disk. */
function realArtifactUsedBy(artifactId) {
  const flowsDir = join(FORGE_ROOT, 'studio', 'flows');
  const labels = [];
  for (const entry of readdirSync(flowsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const flowPath = join(flowsDir, entry.name, 'flow.yaml');
    let flow;
    try { flow = yaml.load(readFileSync(flowPath, 'utf8')); } catch { continue; }
    const nodesById = new Map((flow.nodes ?? []).map((n) => [n.id, n]));
    for (const edge of flow.edges ?? []) {
      if (edge.artifact !== artifactId) continue;
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      if (!fromNode || !toNode) continue; // dangling edge — a different lint's concern
      labels.push(`${flow.id}:${resolveNodeLabel(fromNode)}${EDGE_ARROW}${resolveNodeLabel(toNode)}`);
    }
  }
  return [...new Set(labels)].sort((a, b) => a.localeCompare(b));
}

/** Real recursive file count under a directory — mirrors
 *  template-library.ts's readScaffoldFiles walk (files only, recursive). */
function countScaffoldFiles(dir) {
  let count = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) count += 1;
    }
  };
  walk(dir);
  return count;
}

export const journey = defineJourney({
  id: 'templates',
  title: 'Browse the templates library',
  story:
    'As an operator, I browse the /templates library — planning artifacts, ' +
    'demo-output elements, and project scaffolds unified into one registry, ' +
    'grouped and searchable — then open a planning template\'s detail page ' +
    'to see its real definition and a used-by list DERIVED from the real ' +
    'flow graph, and open a project-scaffold\'s detail page to see its whole ' +
    'file tree rendered through the same file-package viewer /skills uses.',
  beats: [
    {
      id: 'templates-library',
      title: 'The /templates library — three categories, one registry',
      narration:
        'The templates library unifies three previously-siloed on-disk sources — ' +
        'planning artifact templates, demo-output elements, and project scaffolds — ' +
        'into one browsable registry, with per-category counts that always equal ' +
        'the rendered card count in each section.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── TPL-0: the /templates library (three categories, one registry) ──────
        console.log('\n[TPL-0] The /templates library');
        await page.goto(watch.uiUrl + '/templates', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="template-library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="template-library"]').count() > 0, 'TPL-0: /templates renders [data-page="template-library"]');
        await caption(page, 'The templates library — planning artifacts, demo-output elements, and project scaffolds, one registry.');

        // Real counts verified against the repo before pinning (2026-08-04):
        // 7 studio/artifact-templates/*.md + 6 studio/demo-elements/*.md +
        // 2 studio/starters/projects/<id>/ dirs = 15 total.
        const counts = await page.evaluate(() => {
          const root = document.querySelector('[data-page="template-library"]');
          return {
            total: parseInt(root?.getAttribute('data-template-count') ?? '-1', 10),
            planning: parseInt(root?.getAttribute('data-planning-count') ?? '-1', 10),
            demoOutput: parseInt(root?.getAttribute('data-demo-output-count') ?? '-1', 10),
            projectScaffold: parseInt(root?.getAttribute('data-project-scaffold-count') ?? '-1', 10),
          };
        });
        check(counts.total === 15, `TPL-0: data-template-count is the real registry total (${counts.total}, want 15)`);
        check(counts.planning === 7, `TPL-0: data-planning-count matches studio/artifact-templates/*.md (${counts.planning}, want 7)`);
        check(counts.demoOutput === 6, `TPL-0: data-demo-output-count matches studio/demo-elements/*.md (${counts.demoOutput}, want 6)`);
        check(counts.projectScaffold === 2, `TPL-0: data-project-scaffold-count matches studio/starters/projects/<id>/ (${counts.projectScaffold}, want 2)`);

        const cardCounts = await page.evaluate(() => ({
          planning: document.querySelectorAll('[data-template-category="planning"]').length,
          demoOutput: document.querySelectorAll('[data-template-category="demo-output"]').length,
          projectScaffold: document.querySelectorAll('[data-template-category="project-scaffold"]').length,
        }));
        check(cardCounts.planning === counts.planning, `TPL-0: the planning section renders one card per counted entry (${cardCounts.planning} vs ${counts.planning})`);
        check(cardCounts.demoOutput === counts.demoOutput, `TPL-0: the demo-output section renders one card per counted entry (${cardCounts.demoOutput} vs ${counts.demoOutput})`);
        check(cardCounts.projectScaffold === counts.projectScaffold, `TPL-0: the project-scaffold section renders one card per counted entry (${cardCounts.projectScaffold} vs ${counts.projectScaffold})`);

        await frame(page, 'tpl-0-library', 'Part 2 (templates) — the /templates library: three categories, one registry', { key: true });
      },
    },
    {
      id: 'templates-search',
      title: 'Search narrows to the real match',
      narration:
        'Typing into the search field filters by name and description across every ' +
        'category at once, live and client-side — a query matching exactly one real ' +
        'template narrows every section down to just that card.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── TPL-1: search narrows the library (case-insensitive, name+description) ──
        console.log('\n[TPL-1] Search the templates library');
        await page.goto(watch.uiUrl + '/templates', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="template-library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('[data-field="template-search"]').count() > 0, 'TPL-1: the library exposes [data-field="template-search"]');

        await page.locator('[data-field="template-search"]').fill('plan').catch(() => {});
        await page.waitForFunction(
          () => parseInt(document.querySelector('[data-page="template-library"]')?.getAttribute('data-template-count') ?? '-1', 10) === 1,
          null, { timeout: 5000 }).catch(() => {});

        const filtered = await page.evaluate(() => {
          const root = document.querySelector('[data-page="template-library"]');
          return {
            total: parseInt(root?.getAttribute('data-template-count') ?? '-1', 10),
            planning: parseInt(root?.getAttribute('data-planning-count') ?? '-1', 10),
            cards: [...document.querySelectorAll('[data-card-type="template"]')].map((el) => el.getAttribute('data-template-id')),
          };
        });
        check(filtered.total === 1, `TPL-1: searching "plan" narrows to exactly the one real match (${filtered.total}, want 1)`);
        check(filtered.planning === 1, `TPL-1: the sole match sits in the planning section (${filtered.planning}, want 1)`);
        check(filtered.cards.length === 1 && filtered.cards[0] === 'plan', `TPL-1: the rendered card is the real "plan" template (got [${filtered.cards.join(', ')}])`);
        await caption(page, 'Search is case-insensitive over name + description — "plan" narrows all three sections down to the one real match.');
        await frame(page, 'tpl-1-search', 'Part 2 (templates) — search narrows the library to the real match', { key: true });
      },
    },
    {
      id: 'templates-detail-planning',
      title: "A planning template's detail page — definition + derived used-by",
      narration:
        'The Plan template\'s detail page shows its real definition (format, ' +
        'provenance, definition ref) and a used-by list DERIVED from the real flow ' +
        'graph, never hand-maintained — the architect→project-manager edge in ' +
        'forge-architect is the only place "plan" is produced and consumed, and the ' +
        'page cross-checks its own declared producer/consumer against that edge, ' +
        'reporting the endpoints as verified.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── TPL-2: a planning template's detail page (definition + used-by) ──────
        console.log("\n[TPL-2] A planning template's detail page (/templates/plan)");
        const derivedUsage = realArtifactUsedBy('plan');
        check(derivedUsage.length > 0, `TPL-2: "plan" has a real flow edge on disk (${derivedUsage.join(', ')})`);

        await page.goto(watch.uiUrl + '/templates/plan', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="template-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="template-detail"]').count() > 0, 'TPL-2: /templates/plan renders [data-page="template-detail"]');
        check(await page.evaluate(() => document.querySelector('[data-page="template-detail"]')?.getAttribute('data-template-category')) === 'planning',
          'TPL-2: data-template-category="planning"');
        check(await page.locator('[data-section="definition"]').count() > 0, 'TPL-2: [data-section="definition"] renders');
        check(await page.locator('[data-section="endpoints"]').count() > 0, 'TPL-2: [data-section="endpoints"] renders (plan declares a producer + consumer)');
        check(await page.evaluate(() => document.querySelector('[data-page="template-detail"]')?.getAttribute('data-endpoints-verified')) === 'true',
          'TPL-2: data-endpoints-verified="true" — the declared producer/consumer agrees with the real flow edge');

        const usedByCountDom = await page.evaluate(() =>
          parseInt(document.querySelector('[data-section="used-by"]')?.getAttribute('data-used-by-count') ?? '-1', 10));
        check(usedByCountDom === derivedUsage.length, `TPL-2: data-used-by-count matches the derived flow-edge scan (dom=${usedByCountDom}, real=${derivedUsage.length})`);
        const usedByEntriesDom = (await page.evaluate(() =>
          [...document.querySelectorAll('[data-used-by-entry]')].map((el) => el.getAttribute('data-used-by-entry')))).sort();
        check(JSON.stringify(usedByEntriesDom) === JSON.stringify(derivedUsage),
          `TPL-2: the exact used-by entries match the derivation (dom=[${usedByEntriesDom.join(', ')}], real=[${derivedUsage.join(', ')}])`);
        check(await page.locator('[data-template-preview="doc"]').count() > 0, 'TPL-2: the preview block renders data-template-preview="doc" (artifact kind: file)');

        await caption(page, 'Plan\'s used-by is derived from the real flow graph — not declared — and cross-checked here against an independent recompute off studio/flows/*/flow.yaml.');
        await frame(page, 'tpl-2-detail-planning', "Part 2 (templates) — a planning template's detail page: definition + derived used-by", { key: true });
      },
    },
    {
      id: 'templates-detail-scaffold',
      title: 'A project-scaffold detail page — the real file tree',
      narration:
        'The typescript-cli scaffold\'s detail page renders its whole file tree ' +
        'through the SAME FilePackage component /skills/[id] uses — the file count ' +
        'on the page matches the real files on disk, tab by tab, kind-agnostic reuse ' +
        'of one shared component.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── TPL-3: a project-scaffold detail page (the real file tree, tabbed) ───
        console.log('\n[TPL-3] A project-scaffold detail page (/templates/typescript-cli)');
        const realFileCount = countScaffoldFiles(join(FORGE_ROOT, 'studio', 'starters', 'projects', 'typescript-cli'));

        await page.goto(watch.uiUrl + '/templates/typescript-cli', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="template-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="template-detail"]').count() > 0, 'TPL-3: /templates/typescript-cli renders [data-page="template-detail"]');
        check(await page.evaluate(() => document.querySelector('[data-page="template-detail"]')?.getAttribute('data-template-category')) === 'project-scaffold',
          'TPL-3: data-template-category="project-scaffold"');
        check(await page.locator('[data-component="file-package"]').count() > 0, 'TPL-3: [data-component="file-package"] renders');

        const domFileCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-component="file-package"]')?.getAttribute('data-file-count') ?? '-1', 10));
        check(domFileCount === realFileCount,
          `TPL-3: data-file-count matches the real file count under studio/starters/projects/typescript-cli/ (dom=${domFileCount}, real=${realFileCount})`);

        const firstTab = page.locator('[data-file-tab]').first();
        const tabPath = await firstTab.getAttribute('data-file-path');
        await caption(page, `typescript-cli's scaffold — the whole ${realFileCount}-file tree, tabbed, through the same FilePackage component /skills/[id] uses.`);
        await firstTab.click().catch(() => {});
        await page.waitForFunction(
          (p) => document.querySelector('[data-component="file-package"]')?.getAttribute('data-active-file') === p,
          tabPath, { timeout: 5000 }).catch(() => {});
        const activeAfterClick = await page.evaluate(() => document.querySelector('[data-component="file-package"]')?.getAttribute('data-active-file'));
        check(activeAfterClick === tabPath, `TPL-3: clicking [data-file-tab] sets data-active-file (got "${activeAfterClick}", want "${tabPath}")`);
        check(await page.locator('[data-template-preview="scaffold"]').count() > 0, 'TPL-3: the preview block renders data-template-preview="scaffold"');

        await frame(page, 'tpl-3-detail-scaffold', 'Part 2 (templates) — a project-scaffold detail page: the real file tree, tabbed', { key: true });
      },
    },
  ],
});
