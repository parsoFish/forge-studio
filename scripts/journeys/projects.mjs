/**
 * projects — W8-C3: the projects index tells you which project needs you.
 *
 * "Every project forge can build, and which of them is broken" — the operator
 * lands on Home, clicks the Projects pillar, and the index now DISTINGUISHES a
 * contract-broken project from a half-onboarded one from a ready one, carries
 * each project's last activity and open work, and offers search / health
 * filter / sort / needs-you so a roster of any size is navigable. Then they
 * open the ready project and find its skill bindings honest: the project's OWN
 * skill is offered by the picker, and a binding that resolves to nothing says
 * MISSING instead of quietly showing its raw id.
 *
 * Entry-point rule: the clip starts at `/` (Home) and clicks the real nav
 * pillar — never `page.goto('/projects')` mid-flow.
 *
 * WHY A NEW JOURNEY rather than more `home` beats (the W8-C3 pre-decomposition
 * ruling, recorded in `_wave8/lanes/C3-ledger.md`): `home`'s single
 * `home-projects-index` beat is a "the index renders" check inside a journey
 * whose subject is Home. The index now carries three distinct capabilities;
 * cramming them into `home` rots the Home story and hides the projects one.
 *
 * FIXTURES — three throwaway scratch projects, seeded by the FIRST beat behind
 * its own crash-safe leading sweep and swept by the LAST beat that needs them
 * (mirroring home.mjs's own HOME_GATED_PROJECT/HOME_ACTIVE_PROJECT shape).
 * Never mdtoc, never J4_PROJECT, never home.mjs's own ids.
 *
 * GROUNDING (rule 7): `PROJECTS_BROKEN`'s config is the R1-03 legacy flat
 * gate-key shape — literally `quality_gate_cmd` at the top level with no
 * `testProcess` — which is the state the REAL `gitpulse` project is in on this
 * host and the exact shape `GET /api/studio/projects/:id/contract-stages`
 * already answers 409 for (`apps/forge/bridge-studio.ts`'s own migrate-hint branch).
 * It is not an invented "broken" value: it is a copy of the live one, so the
 * health verdict this journey asserts is produced by the real
 * `validateProjectConfig`, not by a fixture the UI was taught to recognise.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, READ, THINK, FORGE_ROOT } from '../lib/journey-fixtures.mjs';
import { sleep, checkHonestPillarRead } from '../lib/journey-assertions.mjs';

export const PROJECTS_BROKEN = 'journey-projects-broken';
export const PROJECTS_UNFINISHED = 'journey-projects-unfinished';
export const PROJECTS_READY = 'journey-projects-ready';
/** Bound in PROJECTS_READY's project.json but present on NO disk anywhere —
 *  the projects-43 shape. */
export const PROJECTS_GHOST_SKILL = 'journey-projects-ghost-skill';
/** Lives INSIDE PROJECTS_READY (`.forge/skills/<id>/SKILL.md`) and therefore
 *  in no forge-wide catalog — the projects-06 shape. */
export const PROJECTS_LOCAL_SKILL = 'journey-projects-local-skill';

const dirOf = (id) => join(FORGE_ROOT, 'projects', id);

function cleanProjectsFixtures() {
  for (const id of [PROJECTS_BROKEN, PROJECTS_UNFINISHED, PROJECTS_READY]) {
    try { rmSync(dirOf(id), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

function seedProjectsFixtures() {
  // 1. CONTRACT BROKEN — the live gitpulse shape (see this file's header).
  mkdirSync(join(dirOf(PROJECTS_BROKEN), '.forge'), { recursive: true });
  writeFileSync(join(dirOf(PROJECTS_BROKEN), '.forge', 'project.json'), JSON.stringify({
    name: 'Fixture: Contract Broken',
    northStar: 'A project whose contract forge cannot load.',
    quality_gate_cmd: 'npm test',
  }, null, 2), 'utf8');

  // 2. HALF-ONBOARDED — the directory exists, the contract file never landed.
  //    `discoverProjects` deliberately still lists it.
  mkdirSync(dirOf(PROJECTS_UNFINISHED), { recursive: true });

  // 3. READY — a valid migrated contract, one project-LOCAL skill on disk, and
  //    one bound skill that exists nowhere.
  mkdirSync(join(dirOf(PROJECTS_READY), '.forge'), { recursive: true });
  writeFileSync(join(dirOf(PROJECTS_READY), '.forge', 'project.json'), JSON.stringify({
    name: 'Fixture: Ready',
    northStar: 'A fully onboarded project forge can build.',
    testProcess: { local: { cmd: ['npm', 'test'] } },
    skills: [PROJECTS_LOCAL_SKILL, PROJECTS_GHOST_SKILL],
  }, null, 2), 'utf8');
  mkdirSync(join(dirOf(PROJECTS_READY), '.forge', 'skills', PROJECTS_LOCAL_SKILL), { recursive: true });
  writeFileSync(
    join(dirOf(PROJECTS_READY), '.forge', 'skills', PROJECTS_LOCAL_SKILL, 'SKILL.md'),
    `---\nname: ${PROJECTS_LOCAL_SKILL}\ndescription: A skill that lives inside this project.\n---\n\nProject-local skill fixture.\n`,
    'utf8',
  );
}

/** Read one card's derived signals straight off the DOM contract. */
const cardAttrs = (id) => `(() => {
  const el = document.querySelector('[data-section="projects-grid"] [data-card-id="${id}"]');
  if (!el) return null;
  const activity = el.querySelector('[data-field="project-activity"]');
  return {
    health: el.getAttribute('data-health'),
    reason: el.querySelector('[data-field="project-health-reason"]')?.textContent ?? null,
    lastActivity: activity?.getAttribute('data-last-activity') ?? null,
    openCount: activity?.getAttribute('data-open-count') ?? null,
  };
})()`;

async function gotoHomeReady(page, watch) {
  await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('[data-page="home"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
}

async function waitProjectsIndexReady(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-page="projects-index"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
}

export const journey = defineJourney({
  id: 'projects',
  title: 'Projects index — which project needs me, and why',
  story: 'As the operator I open the Projects pillar and can tell at a glance which projects forge can build, which are half-onboarded, and which are contract-broken — with the real validator\'s own words for why — plus each project\'s last activity and open work. I filter, sort and search the roster instead of scanning it. Then I open a project and find its skill bindings honest: its own project-local skill is offered back to me, and a binding that resolves to nothing says MISSING instead of showing me its raw id and calling it fine.',
  beats: [
    {
      id: 'projects-index-health',
      title: 'Projects — a broken project no longer looks like a healthy one',
      narration: 'The operator clicks the Projects pillar from Home. Three seeded projects render three DIFFERENT health signals: contract-broken, onboarding unfinished, ready. The broken one\'s reason is the real validateProjectConfig message naming the R1-03 migration — the same verdict the contract-stages route already 409s with, derived per read from .forge/project.json and stored nowhere. Each card also carries its last activity and open-work count, derived from the queue-attention aggregate and the cycle log.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[PROJECTS.1] Home → the Projects pillar');
        cleanProjectsFixtures(); // crash-safe leading sweep
        seedProjectsFixtures();

        try {
          await gotoHomeReady(page, watch);
          await caption(page, 'Home. The Projects pillar is one click away — and the index behind it now says which project needs you.');
          await sleep(THINK);

          await page.click('[data-nav="projects"]');
          await waitProjectsIndexReady(page);
          await caption(page, 'Three projects, three different health signals — derived from each contract on disk, not from a stored flag.');
          await sleep(READ);

          await checkHonestPillarRead(page, check, 'projects-index', 'PROJECTS.1');

          const rollup = await page.evaluate(() => {
            const el = document.querySelector('[data-section="projects-grid"]');
            return el ? {
              count: el.getAttribute('data-count'),
              total: el.getAttribute('data-total'),
              healthy: el.getAttribute('data-health-healthy'),
              attention: el.getAttribute('data-health-attention'),
              broken: el.getAttribute('data-health-broken'),
              unknown: el.getAttribute('data-health-unknown'),
            } : null;
          });
          check(rollup !== null, 'PROJECTS.1: the grid carries the derived health rollup');
          check(rollup?.count === rollup?.total,
            `PROJECTS.1: with no filter active the rendered count equals the roster total (count=${rollup?.count}, total=${rollup?.total})`);
          const summed = ['healthy', 'attention', 'broken', 'unknown']
            .reduce((n, k) => n + parseInt(rollup?.[k] ?? '0', 10), 0);
          check(summed === parseInt(rollup?.total ?? '-1', 10),
            `PROJECTS.1: every project lands in exactly one health bucket — the four counts sum to the roster (sum=${summed}, total=${rollup?.total})`);
          check(parseInt(rollup?.broken ?? '0', 10) >= 1,
            `PROJECTS.1: the roster reports at least one BROKEN project — the seeded flat-gate-key contract (got ${rollup?.broken})`);

          const broken = await page.evaluate(cardAttrs(PROJECTS_BROKEN));
          const unfinished = await page.evaluate(cardAttrs(PROJECTS_UNFINISHED));
          const ready = await page.evaluate(cardAttrs(PROJECTS_READY));

          check(broken?.health === 'broken', `PROJECTS.1: the flat-gate-key project reads BROKEN (got "${broken?.health}")`);
          check(unfinished?.health === 'attention', `PROJECTS.1: the project with no .forge/project.json reads ATTENTION, not broken and not healthy (got "${unfinished?.health}")`);
          check(ready?.health === 'healthy', `PROJECTS.1: the fully onboarded project reads HEALTHY (got "${ready?.health}")`);
          check(broken?.health !== ready?.health,
            'PROJECTS.1: a contract-broken project and a healthy one are no longer visually identical — the defect projects-08 named');

          check(/testProcess/.test(broken?.reason ?? ''),
            `PROJECTS.1: the broken card carries the REAL validator message naming the R1-03 migration, not a re-worded label (got "${(broken?.reason ?? '').slice(0, 120)}")`);
          check((ready?.reason ?? null) === null,
            'PROJECTS.1: a healthy card invents no reason');

          for (const [id, attrs] of [[PROJECTS_BROKEN, broken], [PROJECTS_UNFINISHED, unfinished], [PROJECTS_READY, ready]]) {
            check(attrs?.lastActivity !== null,
              `PROJECTS.1: ${id} carries a derived last-activity value (got "${attrs?.lastActivity}")`);
            check(attrs?.openCount !== null,
              `PROJECTS.1: ${id} carries a derived open-work count (got "${attrs?.openCount}")`);
          }
          check(broken?.lastActivity === 'none',
            `PROJECTS.1: a project with no cycles says "none" — an honest absence, never a fabricated timestamp (got "${broken?.lastActivity}")`);

          await frame(page, 'projects-0-health', '/projects — three projects, three health signals: contract-broken (with the validator\'s own reason), onboarding unfinished, ready', { key: true });
        } catch (err) {
          cleanProjectsFixtures();
          throw err;
        }
      },
    },
    {
      id: 'projects-index-filter',
      title: 'Projects — filter, sort and search a roster instead of scanning it',
      narration: 'The index gained the same operator levers /sessions got in W7-B1: search across id, name and north star; a health filter whose options come from the roster actually present; sort by name, last activity or health; and a needs-you toggle that enumerates the three real cases (a gated verdict, a flagged plan, a contract that is not healthy). The default order is the server\'s own, untouched — a filter only removes rows.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[PROJECTS.2] /projects — filter, sort, search');
        try {
          await page.goto(watch.uiUrl + '/projects', { waitUntil: 'domcontentloaded' });
          await waitProjectsIndexReady(page);

          const total = await page.evaluate(() =>
            parseInt(document.querySelector('[data-section="projects-grid"]')?.getAttribute('data-total') ?? '-1', 10));
          check(total >= 3, `PROJECTS.2: the roster carries at least the three seeded projects (total=${total})`);

          const barCount = await page.locator('[data-section="projects-filters"]').count();
          check(barCount === 1, `PROJECTS.2: the filter bar renders once above the grid (got ${barCount})`);

          await caption(page, 'Search matches the project ID — the token the operator reads off the URL and off project.json.');
          await page.fill('[data-field="filter-search"]', PROJECTS_BROKEN);
          await sleep(ACT);
          const searched = await page.evaluate(() => {
            const el = document.querySelector('[data-section="projects-grid"]');
            return { count: el?.getAttribute('data-count'), total: el?.getAttribute('data-total'), search: el?.getAttribute('data-filter-search') };
          });
          check(searched.count === '1', `PROJECTS.2: searching the broken project's id narrows the grid to exactly it (count=${searched.count})`);
          check(searched.total === String(total), `PROJECTS.2: data-total still reports the WHOLE roster while filtered — the rollup describes the roster, the count describes the grid (total=${searched.total})`);
          check(searched.search === PROJECTS_BROKEN, `PROJECTS.2: the grid declares the constraint it is applying (got "${searched.search}")`);
          await frame(page, 'projects-1-search', '/projects — search matches the project ID, not just its display name', { key: true });

          await page.click('[data-action="clear-filters"]');
          await sleep(ACT);
          const cleared = await page.evaluate(() =>
            document.querySelector('[data-section="projects-grid"]')?.getAttribute('data-count'));
          check(cleared === String(total), `PROJECTS.2: clear restores the full roster (count=${cleared}, total=${total})`);

          await caption(page, 'Filter to just the broken contracts — the option list is built from the roster actually present, never a hardcoded vocabulary.');
          await page.selectOption('[data-field="filter-health"]', 'broken');
          await sleep(ACT);
          const brokenOnly = await page.evaluate(() => {
            const el = document.querySelector('[data-section="projects-grid"]');
            const cards = [...document.querySelectorAll('[data-section="projects-grid"] [data-card-type="project"]')];
            return {
              count: el?.getAttribute('data-count'),
              health: el?.getAttribute('data-filter-health'),
              allBroken: cards.length > 0 && cards.every((c) => c.getAttribute('data-health') === 'broken'),
            };
          });
          check(brokenOnly.health === 'broken', `PROJECTS.2: the grid declares the active health constraint (got "${brokenOnly.health}")`);
          check(brokenOnly.allBroken === true, 'PROJECTS.2: every remaining card really is broken — the filter reads the same derivation the cards do');
          await frame(page, 'projects-2-health-filter', '/projects — filtered to contract-broken projects only', { key: true });

          await page.click('[data-action="clear-filters"]');
          await sleep(THINK);

          await caption(page, 'Sort by health: the projects that need the operator come first.');
          await page.selectOption('[data-field="sort"]', 'health');
          await sleep(ACT);
          const sorted = await page.evaluate(() => {
            const el = document.querySelector('[data-section="projects-grid"]');
            const first = document.querySelector('[data-section="projects-grid"] [data-card-type="project"]');
            return { sort: el?.getAttribute('data-sort'), firstHealth: first?.getAttribute('data-health') };
          });
          check(sorted.sort === 'health', `PROJECTS.2: the grid declares the active sort (got "${sorted.sort}")`);
          check(sorted.firstHealth === 'broken', `PROJECTS.2: worst-first — a broken project sorts to the top (got "${sorted.firstHealth}")`);

          await page.click('[data-action="filter-needs-you"]');
          await sleep(ACT);
          const needsYou = await page.evaluate(() => {
            const el = document.querySelector('[data-section="projects-grid"]');
            const cards = [...document.querySelectorAll('[data-section="projects-grid"] [data-card-type="project"]')];
            return {
              flag: el?.getAttribute('data-filter-needs-you'),
              noneHealthyWithoutWork: cards.every((c) => c.getAttribute('data-health') !== 'healthy'
                || parseInt(c.querySelector('[data-field="project-activity"]')?.getAttribute('data-open-count') ?? '0', 10) > 0),
            };
          });
          check(needsYou.flag === 'true', `PROJECTS.2: the needs-you constraint is declared on the grid (got "${needsYou.flag}")`);
          check(needsYou.noneHealthyWithoutWork === true, 'PROJECTS.2: needs-you never keeps a healthy project with nothing waiting on the operator');
          await frame(page, 'projects-3-needs-you', '/projects — sorted worst-first and narrowed to what actually needs the operator', { key: true });

          await page.click('[data-action="clear-filters"]');
          await sleep(THINK);
        } catch (err) {
          cleanProjectsFixtures();
          throw err;
        }
      },
    },
    {
      id: 'projects-skill-bindings',
      title: 'A project\'s skill picker offers what it owns, and says what is missing',
      narration: 'Opening the ready project: its Relevant Skills panel OFFERS the project\'s OWN skill — the one living at .forge/skills/<id>/SKILL.md, which no forge-wide catalog can see — so an unbound project-local skill can be re-bound (projects-06). And a binding that resolves to nothing SAYS "missing" on screen, not just in an attribute. Story S3 (green, run 2) now asserts the resolution rules themselves on nine real dead bindings — resolved/missing and the source they resolve from — so those checks moved there and left this beat the two things a story cannot express: what the picker OFFERS, and what the operator actually READS.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[PROJECTS.3] the ready project — skill bindings');
        try {
          await page.goto(watch.uiUrl + '/projects', { waitUntil: 'domcontentloaded' });
          await waitProjectsIndexReady(page);
          await caption(page, 'Open the ready project straight from its card.');
          await page.click(`[data-section="projects-grid"] [data-card-id="${PROJECTS_READY}"]`);
          await page.waitForFunction(
            () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 20000 },
          ).catch(() => {});
          await sleep(READ);

          // Scroll the Relevant Skills panel into view before the frame — the
          // editor column scrolls, and a clip whose payoff is off-screen shows
          // the operator nothing (entry -> progression -> PAYOFF).
          await page.evaluate(() => {
            document.querySelector('[data-accepts="skill"]')?.scrollIntoView({ block: 'center' });
          });
          await sleep(ACT);

          // CULLED 2026-09-06 (1.0.md §2.4, M5-B session 9) down to what S3 —
          // green on the real Go/Terraform ground — does NOT assert. Three
          // checks left for S3: the bound project-local skill resolves, its
          // chip says where it lives, and a dead binding reads MISSING. S3
          // beat 4 pins `resolved: 'missing'` + `skill-source: 'missing'` on
          // `ado-api-explorer`, one of NINE real dead bindings, and beat 6
          // pins `resolved: 'ok'` + `skill-source: 'project'` on the same
          // clause after the rebuild — the same rules against a real corpus
          // instead of a fixture built to pass.
          //
          // The two below stay because no story asserts them, and one of them
          // no story CAN:
          //   * what the picker OFFERS is not what the project BINDS, and
          //     `projects-06` is about re-binding an unbound project-local
          //     skill. S3 reads bound chips only.
          //   * `scripts/stories/beats.mjs` resolves `data-*`, by design. A
          //     story can assert `resolved="missing"`; it cannot assert that
          //     the WORD reaches the operator's eye. That is a permanent
          //     expressiveness boundary, not a gap waiting on a beat.
          const bindings = await page.evaluate(({ local, ghost }) => {
            const offered = (id) => document.querySelector(`[data-skill-id="${id}"][data-skill-source]:not(.chip)`);
            const ghostChip = document.querySelector(`.chip[data-kind="skill"][data-skill-id="${ghost}"]`);
            return {
              ghostChipText: (ghostChip?.textContent ?? '').toLowerCase(),
              localOfferedSource: offered(local)?.getAttribute('data-skill-source') ?? null,
            };
          }, { local: PROJECTS_LOCAL_SKILL, ghost: PROJECTS_GHOST_SKILL });

          check(bindings.localOfferedSource === 'project',
            `PROJECTS.3 (projects-06): the project's OWN skill is OFFERED by the picker, so an unbound one can be re-bound (got "${bindings.localOfferedSource}")`);
          check(bindings.ghostChipText.includes('missing'),
            'PROJECTS.3 (projects-43): a dead binding SAYS missing on screen — an attribute nobody renders is not a fix, and no story beat can read a word');

          await caption(page, 'The project-local skill is offered for re-binding; the skill that exists nowhere SAYS missing instead of pretending.');
          await frame(page, 'projects-4-skill-bindings', 'Project page — a project-local skill is offered for re-binding; a binding that resolves to nothing SAYS missing', { key: true });
          await sleep(READ);
        } finally {
          // The LAST beat that needs the fixtures sweeps them — mirroring
          // home-clickthrough's own finally.
          cleanProjectsFixtures();
        }
      },
    },
  ],
});
