import { readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { FORGE_ROOT, caption, THINK } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// ── R3-07 helpers: real, disk-derived cross-checks ──────────────────────────
// Mirrors connections.mjs's own module header precedent exactly: every count
// or state this journey asserts is independently recomputed here (raw
// readFileSync/readdirSync over studio/catalog.yaml + studio/community/hubs.yaml
// + the vendored package trees), never a re-read of what the community
// bridge's own response already claims. This block re-derives
// orchestrator/studio/community-index.ts's D1 (three sources, no fourth
// declared list) / D4 (hub resolved by URL match) / D5 (no invented signals)
// entirely from disk — no TS import from this .mjs harness.

const VENDORED_UPSTREAM_SOURCE = 'https://github.com/parsoFish/forge-studio';

function loadCatalogDoc() {
  return yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'catalog.yaml'), 'utf8'));
}

// W6-CR-1: community skills moved from studio/catalog.yaml's `community-skills:`
// section to studio/community/registry.yaml — read that file directly rather
// than re-deriving from the (now community-skills-less) catalog doc.
function loadRegistryDoc() {
  return yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'community', 'registry.yaml'), 'utf8'));
}

function loadHubsDoc() {
  return yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'community', 'hubs.yaml'), 'utf8'));
}

function realHubs() {
  return loadHubsDoc().hubs;
}

/** D4's own path-segment-boundary match, re-derived here byte-for-byte
 *  (community-index.ts's resolveHub): exact match, or `${hub.url}/` prefix —
 *  never a bare string prefix. */
function resolveHubLocal(upstream, hubs) {
  for (const hub of hubs) {
    if (upstream === hub.url || upstream.startsWith(`${hub.url}/`)) return hub;
  }
  return null;
}

function realVendoredIds(kind) {
  const dir = join(FORGE_ROOT, 'studio', 'community', kind === 'skill' ? 'skills' : 'hooks');
  const marker = kind === 'skill' ? 'SKILL.md' : 'hook.yaml';
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, marker)))
    .map((e) => e.name)
    .sort();
}

/** Independently rebuilds the same (kind, id, hub) triples
 *  listCommunityIndex derives server-side (D1's three sources: catalog
 *  community-skills ∪ vendored-only skills; vendored hooks only; catalog
 *  tools+mcps 1:1) — used only to cross-check totals/hub counts, never to
 *  reconstruct the full wire shape. */
function realCommunityItems() {
  const doc = loadCatalogDoc();
  const registryDoc = loadRegistryDoc();
  const hubs = realHubs();
  const communitySkills = (registryDoc.items ?? []).filter((i) => i.kind === 'skill');
  const catalogSkillIds = new Set(communitySkills.map((cs) => cs.id));
  const items = [];
  for (const cs of communitySkills) {
    items.push({ kind: 'skill', id: cs.id, hub: resolveHubLocal(cs.sourceUrl, hubs) });
  }
  for (const id of realVendoredIds('skill')) {
    if (catalogSkillIds.has(id)) continue; // collision — represented once, above
    items.push({ kind: 'skill', id, hub: resolveHubLocal(VENDORED_UPSTREAM_SOURCE, hubs) });
  }
  for (const id of realVendoredIds('hook')) {
    items.push({ kind: 'hook', id, hub: resolveHubLocal(VENDORED_UPSTREAM_SOURCE, hubs) });
  }
  for (const t of doc.tools ?? []) items.push({ kind: 'tool', id: t.id, hub: resolveHubLocal(t.provenance, hubs) });
  for (const m of doc.mcps ?? []) items.push({ kind: 'mcp', id: m.id, hub: resolveHubLocal(m.provenance, hubs) });
  return items;
}

function realKindCount(kind) { return realCommunityItems().filter((i) => i.kind === kind).length; }
function realHubItemCount(hubId) { return realCommunityItems().filter((i) => i.hub?.id === hubId).length; }
function realTotalCount() { return realCommunityItems().length; }

/** Collapse runs of whitespace (including a markdown-authored line wrap) to a
 *  single space before a literal-phrase match — a paragraph the seed wraps
 *  mid-phrase for line length is still the SAME claim; the assertion should
 *  depend on the words, never on wherever the source happens to wrap them. */
function normalizeWs(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function realCommunitySkillEntry(id) {
  const doc = loadRegistryDoc();
  const entry = (doc.items ?? []).find((cs) => cs.kind === 'skill' && cs.id === id);
  if (!entry) throw new Error(`community journey: "${id}" is missing from studio/community/registry.yaml — fixtures assume it exists`);
  return entry;
}

// ── W6-CR-2 helpers: sort + freshness, re-derived from the real registry ────

/** The registry-sourced item with the HIGHEST numeric signals.stars —
 *  independently recomputed off studio/community/registry.yaml, never a
 *  re-read of the page's own claimed sort order. Used to assert that
 *  switching the sort to stars/desc genuinely reorders the DOM against real
 *  data, not just against whatever the page happened to render first. */
function realTopStarsRegistryEntry() {
  const doc = loadRegistryDoc();
  const withStars = (doc.items ?? []).filter((i) => typeof i.signals?.stars === 'number');
  if (withStars.length === 0) throw new Error('community journey: expected at least one registry item with a numeric signals.stars value');
  return withStars.reduce((best, cur) => (cur.signals.stars > best.signals.stars ? cur : best));
}

/** Sorts a bridge-fetched item list the SAME way sortCommunityItems('name',
 *  'asc') does (plain `localeCompare` ascending) — a local recomputation
 *  over the bridge's own real, already-derived facts, never a re-read of
 *  the DOM's own claimed order (mirrors CM-7's own precedent of fetching
 *  `/api/studio/community` directly and computing the expected value here). */
function sortItemsByNameAscLocal(items) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function realMcpEntry(id) {
  const doc = loadCatalogDoc();
  const entry = (doc.mcps ?? []).find((m) => m.id === id);
  if (!entry) throw new Error(`community journey: "${id}" is missing from studio/catalog.yaml mcps: — fixtures assume it exists`);
  return entry;
}

/** The byte-exact install argv D6/D9 specify, reconstructed independently
 *  from the catalog's own pin — mirrors connections.mjs's own
 *  expectedMemoryInstallArgvText() precedent exactly (this journey's MCP
 *  install demo deliberately reuses `memory`, connections.mjs's own proven
 *  fixture, rather than inventing a second one). */
function expectedMemoryInstallArgvText() {
  const entry = realMcpEntry('memory');
  const connectionsRoot = join(FORGE_ROOT, '_connections');
  const args = [
    'install', '--prefix', connectionsRoot, '--ignore-scripts', '--no-audit', '--no-fund',
    '--save-exact', `${entry.install.package}@${entry.install.version}`,
  ];
  return `npm ${args.join(' ')}`;
}

/** Real, independent DISK check that `memory` is genuinely NOT installed
 *  under the connections root — mirrors connections.mjs's own
 *  realMemoryNotInstalledOnDisk() precedent. This journey never installs it
 *  for real either (D7 stands here too): if this ever reads true, either a
 *  network install leaked into the checkout or a prior journey polluted
 *  `_connections/`. */
function realMemoryNotInstalledOnDisk() {
  const entry = realMcpEntry('memory');
  const pkgJsonPath = join(FORGE_ROOT, '_connections', 'node_modules', ...entry.install.package.split('/'), 'package.json');
  return !existsSync(pkgJsonPath);
}

// ── Fixture ids — the two vendored packages this journey installs for real,
// and the MCP it exercises the suppressed-install path against. ────────────
const CM_SKILL_ID = 'dependency-diff-review';
const CM_SKILL_SRC_PATH = join(FORGE_ROOT, 'studio', 'community', 'skills', CM_SKILL_ID, 'SKILL.md');
const CM_SKILL_DIR = join(FORGE_ROOT, 'skills', CM_SKILL_ID);
const CM_SKILL_MD_PATH = join(CM_SKILL_DIR, 'SKILL.md');

const CM_HOOK_ID = 'block-protected-branch-push';
const CM_HOOK_DIR = join(FORGE_ROOT, 'studio', 'hooks', CM_HOOK_ID);

const CM_MCP_ID = 'memory'; // shared fixture with connections.mjs — see its own header note

// A real, real catalog-sourced skill (never installed by this journey) used
// solely to demonstrate a CATALOG-sourced community card's real hub +
// signals — the honest contrast to CM_SKILL_ID's vendored signals:null.
const CM_CATALOG_SKILL_ID = 'systematic-debugging';

const CM_LEDGER_PATH = join(FORGE_ROOT, 'studio', 'installed-skills.yaml');

// The ledger's EXACT prior state, captured once on first touch — mirrors
// journey-fixtures.mjs's own SK_INSTALL_LEDGER_PATH stash precedent
// (skills.mjs's skills-install-approve beat) byte-for-byte: `undefined` =
// not yet captured, `null` = no ledger file existed before this run, a
// string = its exact original bytes. Restoring to THIS (not a filtered
// re-write) is what avoids leaving `installed: []` dirt behind when no
// ledger file existed pre-run.
let cmLedgerStash;

/** Crash-safe, narrow sweep for THIS journey's own two installed artifacts
 *  only (CM_SKILL_DIR, CM_HOOK_DIR) plus the ledger entry the skill install
 *  wrote — deliberately never the broad cleanSkillArtifacts()/
 *  cleanHookArtifacts() sweeps (those own SK_NEW_SLUG/HK_NEW_ID and other
 *  journeys' throughline artifacts; this journey's ids are disjoint from
 *  every SK_/HK_ constant in journey-fixtures.mjs). Exported so
 *  scripts/e2e-journey.mjs's own top-level finally can call it as a
 *  crash-safe backstop, the same way it already calls cleanSkillArtifacts()
 *  and cleanHookArtifacts() for the skills/hooks pillars.
 */
export function cleanCommunityArtifacts() {
  if (cmLedgerStash === undefined) {
    cmLedgerStash = existsSync(CM_LEDGER_PATH) ? readFileSync(CM_LEDGER_PATH, 'utf8') : null;
  }
  try { rmSync(CM_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(CM_HOOK_DIR, { recursive: true, force: true }); } catch { /* */ }
  if (cmLedgerStash === null) {
    try { rmSync(CM_LEDGER_PATH, { force: true }); } catch { /* */ }
  } else {
    try { writeFileSync(CM_LEDGER_PATH, cmLedgerStash, 'utf8'); } catch { /* */ }
  }
}

// ── HTML5 DataTransfer DnD helper is NOT needed here — this journey never
// binds anything into an agent builder; it only proves a draft/needs-review
// artifact is ABSENT from the palette, and (skill only) present after a real
// R3-01 approval. ─────────────────────────────────────────────────────────

export const journey = defineJourney({
  id: 'community',
  title: 'Browse the cross-kind community index and install through the owning pipelines',
  story:
    'As an operator, I discover community objects from inside the /skills and ' +
    '/connections shelves themselves, land on the ONE cross-kind /community ' +
    'browser (skills, hooks, MCPs, tools — real per-hub item counts, honest ' +
    'zeros included), open a vendored skill\'s pre-install detail page ' +
    '(SKILL.md preview, hub + backing-repo links) next to a catalog-sourced ' +
    'card\'s real hub signals, install the skill and watch it land quarantined ' +
    'and absent from the agent-builder palette, open a vendored hook\'s ' +
    'pre-install SECURITY SCAN, install it and watch it stay unrunnable with ' +
    'no approval-ledger entry, return to /skills and read the install\'s real ' +
    'provenance, approve it on R3-01\'s own surface and watch it turn ' +
    'palette-visible, then browse an MCP\'s curated capability list and click ' +
    'Install under this harness\'s no-spawn bridge — suppressed, byte-exact ' +
    'argv shown, the connection\'s real state genuinely unchanged.',
  beats: [
    {
      id: 'community-skills-entry',
      title: 'The /skills shelf — the community entry point starts here',
      narration:
        'Skills and hooks ride on the existing communities: the /skills ' +
        'library itself is where the browse-community entry point lives, not ' +
        'a separate marketplace tab.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-1] The /skills shelf');
        await page.goto(watch.uiUrl + '/skills', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="skill-library"]').count() > 0, 'CM-1: /skills renders [data-page="skill-library"]');
        const communityCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="skill-library"]')?.getAttribute('data-community-count') ?? '-1', 10));
        check(communityCount > 0, `CM-1: the Community section is populated (${communityCount})`);
        check(await page.locator('[data-action="browse-community"]').count() > 0,
          'CM-1: /skills exposes [data-action="browse-community"] — the entry point into the cross-kind browser');
        await caption(page, 'Skills and hooks ride on the existing communities — browse-community starts right here on the shelf.');
      },
    },
    {
      id: 'community-skills-card-signals',
      title: 'A community card already shows its derived hub + signals',
      narration:
        `A CATALOG-sourced card (${CM_CATALOG_SKILL_ID}) on the /skills shelf ` +
        'carries a real, derived hub id and hub-attributed signals — cross-' +
        "checked against the catalog's own stars/provenance fields, never a " +
        'fabricated number.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log(`\n[CM-2] A community card's derived hub + signals (${CM_CATALOG_SKILL_ID})`);
        // The join has its OWN readiness signal, independent of data-page-ready
        // (which tracks only the primary skills fetch — the list is
        // deliberately not raced by the community join). Reading the hub/
        // signals attributes before the join settles would race a "still
        // loading" state that looks identical to "this skill has no hub".
        await page.waitForFunction(
          () => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-community-join') !== 'pending',
          null, { timeout: 15000 }).catch(() => {});
        const joinStatus = await page.evaluate(() => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-community-join'));
        check(joinStatus === 'ready', `CM-2: the community join settled to "ready" (got "${joinStatus}") — a run where it stays unavailable must fail loudly here, not silently skip the checks below`);
        const real = realCommunitySkillEntry(CM_CATALOG_SKILL_ID);
        const card = page.locator(`[data-card-type="skill"][data-skill-id="${CM_CATALOG_SKILL_ID}"]`);
        check(await card.count() > 0, `CM-2: the ${CM_CATALOG_SKILL_ID} community card is listed`);
        const domSource = await card.getAttribute('data-skill-source');
        check(domSource === 'community', `CM-2: ${CM_CATALOG_SKILL_ID} reads data-skill-source="community" (got "${domSource}")`);
        const domHub = await card.getAttribute('data-skill-hub');
        const realHub = resolveHubLocal(real.sourceUrl, realHubs());
        check(domHub === realHub?.id, `CM-2: data-skill-hub matches the registry sourceUrl's real resolved hub (dom="${domHub}", real="${realHub?.id}")`);
        const domHasSignals = await card.getAttribute('data-skill-has-signals');
        check(domHasSignals === 'true', `CM-2: data-skill-has-signals="true" — ${CM_CATALOG_SKILL_ID} carries real stars (${real.signals?.starsDisplay ?? 'n/a'}) (got "${domHasSignals}")`);
        await frame(page, 'cm-1-skills-card-signals', 'Part 2 (community) — a community card already carries its derived hub + signals on the /skills shelf', { key: true });
      },
    },
    {
      id: 'community-browse-entry',
      title: 'Browse the full catalogue — the cross-kind /community shelf',
      narration:
        'Clicking browse-community lands on the ONE cross-kind index over ' +
        'skills, hooks, MCPs and tools — the total item count is ' +
        'independently recomputed off studio/catalog.yaml + the vendored ' +
        'package trees, never a re-read of the shelf\'s own claim.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-3] browse-community → /community');
        await page.locator('[data-action="browse-community"]').click().catch(() => {});
        await page.waitForURL('**/community', { timeout: 10000 }).catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="community-browser"]').count() > 0, 'CM-3: /community renders [data-page="community-browser"]');
        const real = realTotalCount();
        const domCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10));
        check(domCount === real, `CM-3: data-item-count matches the independently-recomputed cross-kind total (dom=${domCount}, real=${real})`);
        const domCardCount = await page.evaluate(() => document.querySelectorAll('[data-card-type="community-item"]').length);
        check(domCardCount === real, `CM-3: one rendered card per real item (${domCardCount} vs ${real})`);
        await caption(page, 'The cross-kind community browser — skills, hooks, MCPs, tools, one shelf.');
      },
    },
    {
      id: 'community-hub-strip',
      title: 'The hub strip — real per-hub item counts, an honest zero included',
      narration:
        'Every source hub renders with a DERIVED item count — forge\'s own ' +
        'seed hub (the two vendored packages), the superpowers hub (three ' +
        'catalog skills), and skills.sh, which forge indexes NOTHING from ' +
        'yet: it still renders "0 items", never dropped from the strip.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log('\n[CM-4] The hub strip — real per-hub counts');
        check(await page.locator('[data-component="hub-strip"]').count() > 0, 'CM-4: [data-component="hub-strip"] renders');
        const realHubCount = realHubs().length;
        const domHubCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-hub-count') ?? '-1', 10));
        check(domHubCount === realHubCount, `CM-4: data-hub-count matches studio/community/hubs.yaml's real hub count (dom=${domHubCount}, real=${realHubCount})`);

        for (const hubId of ['forge-seed', 'superpowers']) {
          const real = realHubItemCount(hubId);
          const dom = parseInt((await page.locator(`[data-hub-id="${hubId}"]`).getAttribute('data-hub-item-count')) ?? '-1', 10);
          check(dom === real, `CM-4: hub "${hubId}"'s data-hub-item-count is derived, not declared (dom=${dom}, real=${real})`);
        }

        // The honest zero — skills.sh is a real, registered hub with nothing
        // indexed from it today. It still renders, with a genuine "0", never
        // silently dropped from the strip.
        const zeroReal = realHubItemCount('skills-sh');
        check(zeroReal === 0, 'CM-4: (sanity) skills.sh genuinely has zero real items in this checkout — the honest-zero case this beat proves');
        const zeroCard = page.locator('[data-hub-id="skills-sh"]');
        check(await zeroCard.count() > 0, 'CM-4: the skills.sh hub is listed even though it has zero items — never dropped for being empty');
        const zeroDom = await zeroCard.getAttribute('data-hub-item-count');
        check(zeroDom === '0', `CM-4: skills.sh reads a genuine "0", not a fabricated or missing count (got "${zeroDom}")`);
        await caption(page, 'Every hub renders — including skills.sh, which forge indexes nothing from yet: an honest zero, never dropped.');
        await frame(page, 'cm-2-hub-strip', 'Part 2 (community) — the hub strip: real per-hub counts, an honest zero for skills.sh', { key: true });
      },
    },
    {
      id: 'community-sort-freshness',
      title: 'Sorting the index — deterministic against the registry data, plus the seed-never-verified badge',
      narration:
        'Ordering is SIMPLE SORTS ONLY (name / stars / updated / source), ' +
        'operator-locked — no search/facets/tags sort exists. The default ' +
        'is name/asc, independently recomputed off the bridge\'s own real ' +
        'items, not a re-read of the page\'s own claim; switching to ' +
        'stars/desc reorders the first card to the REAL highest-starred ' +
        'registry entry. A seed item (never actually re-fetched from ' +
        'upstream) honestly reads "seed — never verified", never a ' +
        'fabricated date.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-4b] Sorting the community index + the seed-never-verified badge');

        // Default sort: name/asc — independently recomputed off the bridge's
        // own real item list (never a re-read of the DOM's own claim).
        const domSortKey = await page.evaluate(() => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-sort-key'));
        const domSortDir = await page.evaluate(() => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-sort-dir'));
        check(domSortKey === 'name', `CM-4b: the default sort key is "name" (got "${domSortKey}")`);
        check(domSortDir === 'asc', `CM-4b: the default sort direction is "asc" (got "${domSortDir}")`);

        const preRes = await fetch(watch.bridgeUrl + '/api/studio/community');
        const preBody = await preRes.json().catch(() => ({ items: [] }));
        const expectedFirstByName = sortItemsByNameAscLocal(preBody.items ?? [])[0];
        check(!!expectedFirstByName, 'CM-4b: (sanity) the bridge index has at least one item to sort');
        const firstCardId = await page.locator('[data-card-type="community-item"]').first().getAttribute('data-item-id');
        check(firstCardId === expectedFirstByName.id, `CM-4b: the default (name/asc) first card matches the independently-recomputed name order (dom="${firstCardId}", real="${expectedFirstByName.id}")`);

        // Switch to stars, then flip to descending — the first card must
        // change to the REAL highest-signals.stars registry entry.
        await page.locator('select[data-community-sort]').selectOption('stars').catch(() => {});
        await page.locator('[data-action="toggle-sort-direction"]').click().catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-sort-dir') === 'desc',
          null, { timeout: 5000 }).catch(() => {});
        const realTopStars = realTopStarsRegistryEntry();
        const starsFirstCard = page.locator('[data-card-type="community-item"]').first();
        await page.waitForFunction(
          (expectedId) => document.querySelector('[data-card-type="community-item"]')?.getAttribute('data-item-id') === expectedId,
          realTopStars.id, { timeout: 5000 }).catch(() => {});
        const starsFirstId = await starsFirstCard.getAttribute('data-item-id');
        check(starsFirstId === realTopStars.id, `CM-4b: changing sort to stars/desc reorders the first card to the REAL highest-starred registry entry "${realTopStars.id}" (${realTopStars.signals.stars} stars) (got "${starsFirstId}")`);
        await frame(page, 'cm-2b-sort-stars', 'Part 2 (community) — sorted by stars/desc: the first card reorders to the real highest-starred entry', { key: true });

        // A seed item (this checkout's registry has never had a real refresh
        // pass run — see registry.yaml's own file header) honestly reads
        // "seed — never verified", never a fabricated date. Switch back to
        // name/asc first so the fixed CM_CATALOG_SKILL_ID card is reachable
        // regardless of where stars/desc happened to place it.
        await page.locator('select[data-community-sort]').selectOption('name').catch(() => {});
        await page.locator('[data-action="toggle-sort-direction"]').click().catch(() => {}); // back to asc
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-sort-dir') === 'asc',
          null, { timeout: 5000 }).catch(() => {});
        const seedEntry = realCommunitySkillEntry(CM_CATALOG_SKILL_ID);
        check(seedEntry.fetchedAt === null, `CM-4b: (sanity) the real registry entry for "${CM_CATALOG_SKILL_ID}" genuinely has fetchedAt: null`);
        const seedCard = page.locator(`[data-card-type="community-item"][data-item-id="${CM_CATALOG_SKILL_ID}"][data-item-kind="skill"]`);
        check(await seedCard.count() > 0, `CM-4b: the seed item "${CM_CATALOG_SKILL_ID}" card is present`);
        const hasFetchedAtAttr = await seedCard.evaluate((el) => el.hasAttribute('data-fetched-at'));
        check(hasFetchedAtAttr === false, 'CM-4b: data-fetched-at is ABSENT for a null fetchedAt — never a fabricated attribute value');
        const badge = seedCard.locator('[data-component="freshness-badge"]');
        check(await badge.count() > 0, 'CM-4b: the freshness badge renders on the card');
        const badgeState = await badge.getAttribute('data-freshness');
        check(badgeState === 'seed', `CM-4b: data-freshness="seed" for a never-verified item (got "${badgeState}")`);
        const badgeText = await badge.textContent();
        check(/seed — never verified/.test(badgeText ?? ''), `CM-4b: the badge reads the spec-literal "seed — never verified" (got "${(badgeText ?? '').trim()}")`);
        check(!/\d{4}-\d{2}-\d{2}/.test(badgeText ?? ''), 'CM-4b: the badge never renders a raw date for a null fetchedAt');
        await caption(page, 'Simple sorts only — name/stars/updated/source. A seed item honestly reads "seed — never verified", never a fabricated date.');
        await frame(page, 'cm-2c-freshness-badge', 'Part 2 (community) — the seed-never-verified freshness badge, never a fabricated date', { key: true });
      },
    },
    {
      id: 'community-filter-skill',
      title: 'Filter to skills',
      narration:
        'Filtering to skill narrows to the catalog\'s community-skills union ' +
        'the vendored-only package — independently recomputed off disk, never ' +
        'a re-read of the filtered count the page itself renders.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log('\n[CM-5] Filter to skills');
        await page.locator('[data-action="filter-kind"][data-kind="skill"]').click().catch(() => {});
        const real = realKindCount('skill');
        await page.waitForFunction(
          (n) => parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10) === n,
          real, { timeout: 5000 }).catch(() => {});
        const dom = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10));
        check(dom === real, `CM-5: filtering to skill narrows to the real catalog∪vendored union (dom=${dom}, real=${real})`);
        const kinds = await page.evaluate(() => [...document.querySelectorAll('[data-card-type="community-item"]')].map((el) => el.getAttribute('data-item-kind')));
        check(kinds.every((k) => k === 'skill'), 'CM-5: every rendered card is kind="skill"');
        check(await page.locator(`[data-item-id="${CM_SKILL_ID}"][data-item-kind="skill"]`).count() > 0,
          `CM-5: the vendored ${CM_SKILL_ID} is present under the skill filter`);
        await caption(page, 'Filtered to skills — the catalog∪vendored union, recomputed off disk.');
        await frame(page, 'cm-3-filter-skill', 'Part 2 (community) — kind filtering: skill', { key: true });
      },
    },
    {
      id: 'community-skill-detail-open',
      title: "The vendored dependency-diff-review's pre-install detail page",
      narration:
        `A vendored community skill (${CM_SKILL_ID}) opens its own real ` +
        'pre-install detail page: hub resolved to forge\'s own seed, and — ' +
        'honestly — no signals (the vendored seed publishes none, unlike the ' +
        `catalog-sourced ${CM_CATALOG_SKILL_ID} the previous beat checked).`,
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-6] ${CM_SKILL_ID}'s pre-install detail page`);
        await page.locator(`[data-card-type="community-item"][data-item-id="${CM_SKILL_ID}"][data-item-kind="skill"]`).click().catch(() => {});
        await page.waitForURL(`**/community/skill/${CM_SKILL_ID}`, { timeout: 10000 }).catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="community-detail"]').count() > 0, `CM-6: /community/skill/${CM_SKILL_ID} renders [data-page="community-detail"]`);
        check(await page.evaluate(() => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-item-kind')) === 'skill',
          'CM-6: data-item-kind="skill"');
        check(await page.evaluate(() => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-install-state')) === 'not-installed',
          'CM-6: data-install-state="not-installed" — pre-install');

        const hubs = realHubs();
        const realHub = resolveHubLocal(VENDORED_UPSTREAM_SOURCE, hubs);
        check(realHub?.id === 'forge-seed', '(sanity) the vendored upstream URL resolves to the real forge-seed hub');
        check(await page.locator('[data-section="hub-signals"][data-hub-id="forge-seed"]').count() > 0,
          'CM-6: [data-section="hub-signals"] resolves the vendored skill to the real forge-seed hub');
        const hasSignalSource = await page.evaluate(() => document.querySelector('[data-section="hub-signals"]')?.hasAttribute('data-signal-source'));
        check(hasSignalSource === false, 'CM-6: data-signal-source is ABSENT — the vendored seed honestly publishes no signals (D5)');
        const signalsText = await page.evaluate(() => document.querySelector('[data-section="hub-signals"]')?.textContent ?? '');
        check(/no signals published/.test(signalsText), 'CM-6: the page states "no signals published" rather than a fabricated zero');
        const upstreamText = await page.evaluate(() => document.querySelector('[data-section="hub-signals"]')?.textContent ?? '');
        check(upstreamText.includes(VENDORED_UPSTREAM_SOURCE), 'CM-6: the real forge-seed upstream link renders');
        await caption(page, `${CM_SKILL_ID} — vendored, forge-seed hub, honestly no signals published.`);
        await frame(page, 'cm-4-skill-detail', 'Part 2 (community) — the vendored skill\'s pre-install detail page: hub resolved, no fabricated signals', { key: true });
      },
    },
    {
      id: 'community-skill-detail-signals',
      title: 'SKILL.md preview via the file package — enough to judge it',
      narration:
        'The SKILL.md preview is the REAL vendored bytes, tabbed through the ' +
        'shared file-package component, rendered BEFORE install so the ' +
        'operator reads what they would be approving — plus an independent ' +
        `cross-check that ${CM_CATALOG_SKILL_ID} (catalog-sourced) genuinely ` +
        'carries real signals in the same index, the honest contrast this ' +
        'skill\'s own signals:null makes visible.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-7] SKILL.md preview + the catalog-signals cross-check');
        check(await page.locator('[data-component="file-package"]').count() > 0, 'CM-7: [data-component="file-package"] renders');
        const realBody = readFileSync(CM_SKILL_SRC_PATH, 'utf8');
        const domFileCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-component="file-package"]')?.getAttribute('data-file-count') ?? '-1', 10));
        check(domFileCount === 1, `CM-7: the vendored package is exactly one file (SKILL.md) (dom=${domFileCount})`);
        const previewText = await page.evaluate(() => document.querySelector('[data-component="file-package"]')?.textContent ?? '');
        check(previewText.includes('Dependency diff review'), 'CM-7: the real SKILL.md body renders — its own title, not a stub');
        // Whitespace-normalized comparison — the seed's own markdown wraps this
        // exact phrase mid-line ("permanently quarantined at\ninstall"), so a
        // literal .includes() against the raw bytes can never match; the CLAIM
        // is what this beat asserts, not where the source happens to wrap it.
        const normalizedBody = normalizeWs(realBody);
        const normalizedPreview = normalizeWs(previewText);
        check(normalizedBody.includes('permanently quarantined at install'), '(sanity) the vendored SKILL.md itself documents the quarantine contract');
        check(normalizedPreview.includes('permanently quarantined at install'), 'CM-7: the quarantine-contract paragraph is visible in the preview — the operator reads it before installing');

        // The honest contrast — independently re-fetch the community index
        // (never the DOM's own memory of it) and confirm the CATALOG-sourced
        // sibling carries real hub-attributed signals, unlike this vendored one.
        const catalogRes = await fetch(watch.bridgeUrl + '/api/studio/community');
        const catalogBody = await catalogRes.json().catch(() => ({ items: [] }));
        const sibling = (catalogBody.items ?? []).find((it) => it.kind === 'skill' && it.id === CM_CATALOG_SKILL_ID);
        check(!!sibling && sibling.signals !== null, `CM-7: the bridge's own list confirms ${CM_CATALOG_SKILL_ID} carries real signals (${JSON.stringify(sibling?.signals)})`);
        const vendoredSelf = (catalogBody.items ?? []).find((it) => it.kind === 'skill' && it.id === CM_SKILL_ID);
        check(!!vendoredSelf && vendoredSelf.signals === null, `CM-7: the SAME list confirms ${CM_SKILL_ID} carries signals:null — the vendored seed honestly publishes none`);
        await frame(page, 'cm-5-skill-preview', 'Part 2 (community) — SKILL.md preview (real bytes) + the catalog-signals cross-check', { key: true });
      },
    },
    {
      id: 'community-skill-install',
      title: 'Install the skill — lands quarantined, absent from the palette',
      narration:
        "Install routes to R3-01-F4's real draft→scan→approve pipeline — a " +
        'draft on disk, runtime/allowed-tools/library quarantined, and ' +
        'structurally absent from the agent-builder palette until an ' +
        'operator approves it.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-8] Install ${CM_SKILL_ID}`);
        cleanCommunityArtifacts(); // stale-state sweep first (crash-safe, this journey's own artifacts only)

        const installBtn = page.locator('[data-action="install-community-item"]');
        check(await installBtn.count() > 0, 'CM-8: [data-action="install-community-item"] renders (vendored ⇒ routable)');
        check((await installBtn.getAttribute('data-install-routed-to')) === 'skill-draft',
          'CM-8: the button declares its own routing target — data-install-routed-to="skill-draft"');
        await installBtn.click().catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-component="install-outcome"]') !== null,
          null, { timeout: 15000 }).catch(() => {});
        const outcomeText = await page.evaluate(() => document.querySelector('[data-component="install-outcome"]')?.textContent ?? '');
        check(/Installed as a draft/.test(outcomeText), `CM-8: the outcome reads "Installed as a draft." (got "${outcomeText.trim().slice(0, 80)}")`);

        check(existsSync(CM_SKILL_MD_PATH), `CM-8: skills/${CM_SKILL_ID}/SKILL.md lands on disk`);
        const installedRaw = readFileSync(CM_SKILL_MD_PATH, 'utf8');
        check(/^status: draft$/m.test(installedRaw), 'CM-8: the installed package is quarantined as status: draft');
        const topFrontmatter = installedRaw.split(/\nquarantined:/)[0];
        check(!/^runtime:/m.test(topFrontmatter), 'CM-8: runtime: is NOT top-level after install (moved under quarantined:, D4 R3-01)');

        await page.waitForFunction(
          () => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-install-state') === 'draft-pending-approval',
          null, { timeout: 10000 }).catch(() => {});
        const domState = await page.evaluate(() => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-install-state'));
        check(domState === 'draft-pending-approval', `CM-8: the community page's own state flips to draft-pending-approval on refetch (got "${domState}")`);

        await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
        const draftInPalette = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${CM_SKILL_ID}"]`).count();
        check(draftInPalette === 0, `CM-8: the draft is NOT in the agent-builder palette (found ${draftInPalette})`);
        await caption(page, 'Installed — quarantined as a draft, structurally absent from the agent-builder palette.');
        await frame(page, 'cm-6-skill-draft', 'Part 2 (community) — install routes to R3-01-F4: a draft, not palette-visible', { key: true });
      },
    },
    {
      id: 'community-hook-detail',
      title: "The vendored hook's pre-install SECURITY SCAN",
      narration:
        'The hook filter narrows to the one vendored hook; its detail page ' +
        'renders the REAL pre-install security scan — run on the vendored ' +
        'bytes before any install, the same scanner the owning pipeline runs.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-9] Filter to hooks, open ${CM_HOOK_ID}'s pre-install SECURITY SCAN`);
        await page.goto(watch.uiUrl + '/community', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        await page.locator('[data-action="filter-kind"][data-kind="hook"]').click().catch(() => {});
        const realHookCount = realKindCount('hook');
        await page.waitForFunction(
          (n) => parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10) === n,
          realHookCount, { timeout: 5000 }).catch(() => {});
        const domHookCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10));
        check(domHookCount === realHookCount, `CM-9: kind filtering: hook narrows to the real vendored-only count (dom=${domHookCount}, real=${realHookCount})`);

        await page.locator(`[data-card-type="community-item"][data-item-id="${CM_HOOK_ID}"][data-item-kind="hook"]`).click().catch(() => {});
        await page.waitForURL(`**/community/hook/${CM_HOOK_ID}`, { timeout: 10000 }).catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="community-detail"]').count() > 0, `CM-9: /community/hook/${CM_HOOK_ID} renders`);
        check(await page.locator('[data-component="file-package"]').count() > 0, 'CM-9: [data-component="file-package"] renders (hook.yaml + its script)');
        const domFileCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-component="file-package"]')?.getAttribute('data-file-count') ?? '-1', 10));
        check(domFileCount === 2, `CM-9: the vendored hook package is exactly 2 files (hook.yaml + scripts/run.sh) (dom=${domFileCount})`);

        check(await page.locator('[data-section="security-scan"]').count() > 0, 'CM-9: [data-section="security-scan"] renders — the pre-install panel');
        const domVerdict = await page.evaluate(() => document.querySelector('[data-section="security-scan"]')?.getAttribute('data-scan-verdict'));
        check(domVerdict === 'clean', `CM-9: the real vendored script has nothing to flag — verdict "clean" (got "${domVerdict}")`);
        const domFindings = await page.evaluate(() => document.querySelector('[data-section="security-scan"]')?.getAttribute('data-finding-count'));
        check(domFindings === '0', `CM-9: zero findings (got ${domFindings})`);
        const realScript = readFileSync(join(FORGE_ROOT, 'studio', 'community', 'hooks', CM_HOOK_ID, 'scripts', 'run.sh'), 'utf8');
        check(!/curl|wget|fetch\(/.test(realScript), '(sanity) the real vendored script genuinely makes no network call — the clean verdict means something');
        await caption(page, 'The pre-install SECURITY SCAN — run on the real vendored bytes, before any install exists.');
        await frame(page, 'cm-7-hook-scan', 'Part 2 (community) — the vendored hook\'s pre-install SECURITY SCAN: clean, zero findings', { key: true });
      },
    },
    {
      id: 'community-hook-install',
      title: 'Install the hook — materialised, but not runnable',
      narration:
        'Install routes to R3-03-F2\'s hook pipeline: the vendored bytes land ' +
        'on disk, but the install NEVER writes an approval-ledger entry — so ' +
        'even a cleanly-scanned hook stays unrunnable on its own owning page ' +
        'until an operator explicitly approves it there.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-10] Install ${CM_HOOK_ID}`);
        const installBtn = page.locator('[data-action="install-community-item"]');
        check((await installBtn.getAttribute('data-install-routed-to')) === 'hook-needs-approval',
          'CM-10: data-install-routed-to="hook-needs-approval"');
        await installBtn.click().catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-component="install-outcome"]') !== null,
          null, { timeout: 15000 }).catch(() => {});
        const outcomeText = await page.evaluate(() => document.querySelector('[data-component="install-outcome"]')?.textContent ?? '');
        check(/Installed as a draft/.test(outcomeText), `CM-10: the outcome reads "Installed as a draft." (got "${outcomeText.trim().slice(0, 80)}")`);
        check(existsSync(join(CM_HOOK_DIR, 'hook.yaml')), `CM-10: studio/hooks/${CM_HOOK_ID}/hook.yaml lands on disk`);
        check(existsSync(join(CM_HOOK_DIR, 'scripts', 'run.sh')), `CM-10: studio/hooks/${CM_HOOK_ID}/scripts/run.sh lands on disk`);

        // Real, independent disk check: installCommunityHookPackage never
        // writes an approval-ledger entry — confirmed against the ledger file
        // itself, never the product's own claim.
        const ledgerPath = join(FORGE_ROOT, 'studio', 'hook-approvals.yaml');
        let ledgerHasEntry = false;
        if (existsSync(ledgerPath)) {
          const doc = yaml.load(readFileSync(ledgerPath, 'utf8')) ?? {};
          const approved = doc.approved ?? [];
          ledgerHasEntry = Array.isArray(approved) && approved.some((e) => e?.id === CM_HOOK_ID);
        }
        check(!ledgerHasEntry, `CM-10: studio/hook-approvals.yaml carries NO entry for ${CM_HOOK_ID} — install never writes one (D2)`);

        // The owning R3-03 surface (/hooks/[id]) is where runnability actually
        // lives — the community page owns zero trust decisions (D2).
        await page.goto(watch.uiUrl + `/hooks/${CM_HOOK_ID}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="hook-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 15000 }).catch(() => {});
        check(await page.locator('main[data-page="hook-detail"]').count() > 0, `CM-10: /hooks/${CM_HOOK_ID} (the OWNING surface) renders`);
        const domVerdict = await page.evaluate(() => document.querySelector('[data-page="hook-detail"]')?.getAttribute('data-hook-verdict'));
        check(domVerdict === 'clean', `CM-10: the real scan verdict is "clean" (got "${domVerdict}")`);
        const domTrust = await page.evaluate(() => document.querySelector('[data-page="hook-detail"]')?.getAttribute('data-hook-trust'));
        check(domTrust === 'needs-review', `CM-10: trust reads "needs-review" — a clean scan is not the same as an operator's approval (got "${domTrust}")`);
        const domRunnable = await page.evaluate(() => document.querySelector('[data-page="hook-detail"]')?.getAttribute('data-hook-runnable'));
        check(domRunnable === 'false', `CM-10: data-hook-runnable="false" — not runnable with no approval-ledger entry, even though the scan is clean (got "${domRunnable}")`);
        check(await page.locator('[data-action="approve-hook"]').count() > 0,
          'CM-10: the real approval control DOES exist on the owning page — this journey deliberately stops short of clicking it (the browser owns zero trust decisions)');
        await caption(page, 'Installed — but not runnable. A clean scan is not an approval; no ledger entry exists yet.');
        await frame(page, 'cm-8-hook-installed', 'Part 2 (community) — installed, still not runnable: clean scan, no approval-ledger entry', { key: true });
      },
    },
    {
      id: 'community-skills-shelf-return',
      title: 'Back on the local shelf — the install with its real provenance',
      narration:
        `Back on /skills, ${CM_SKILL_ID} now lives in the LOCAL section — ` +
        'filesystem wins on existence (D5): once installed, a vendored ' +
        'community package is a plain local skill on disk, not a permanent ' +
        '"community" badge.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-11] Back on /skills — ${CM_SKILL_ID}'s real state`);
        await page.goto(watch.uiUrl + '/skills', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        const card = page.locator(`[data-card-type="skill"][data-skill-id="${CM_SKILL_ID}"]`);
        check(await card.count() > 0, `CM-11: ${CM_SKILL_ID} is listed on the real /skills shelf`);
        const domSource = await card.getAttribute('data-skill-source');
        check(domSource === 'local', `CM-11: data-skill-source="local" — once installed, filesystem wins on existence (D5), never stuck reading "community" forever (got "${domSource}")`);
        const domInstalled = await card.getAttribute('data-skill-installed');
        check(domInstalled === 'true', `CM-11: data-skill-installed="true" (got "${domInstalled}")`);
        const domTrust = await card.getAttribute('data-skill-trust');
        check(domTrust === 'draft', `CM-11: data-skill-trust="draft" — quarantined, not yet approved (got "${domTrust}")`);
        await caption(page, 'Local now — the install landed as a real skill on disk, provenance kept.');
        await frame(page, 'cm-9-skills-shelf-return', 'Part 2 (community) — back on the local shelf: installed, provenance kept, still a draft', { key: true });
      },
    },
    {
      id: 'community-skills-detail-provenance',
      title: "The skill's own detail page — real provenance, R3-01's approval gate",
      narration:
        "R3-01's own /skills/<id> surface is where the install's real " +
        'provenance renders and where the approval gate lives — the browser ' +
        'never duplicates either.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-12] /skills/${CM_SKILL_ID} — provenance + approval gate`);
        await page.goto(watch.uiUrl + `/skills/${CM_SKILL_ID}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.evaluate(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust')) === 'draft',
          'CM-12: detail page reports data-skill-trust="draft"');
        check(await page.locator('[data-section="approval-gate"]').count() > 0, 'CM-12: [data-section="approval-gate"] renders for the draft');
        const bodyText = await page.evaluate(() => document.body.textContent ?? '');
        check(bodyText.includes(VENDORED_UPSTREAM_SOURCE), `CM-12: the real forge-seed provenance URL renders on the skill's own detail page`);
        await caption(page, "R3-01's own surface — real provenance, the approval gate the browser never duplicates.");
        await frame(page, 'cm-10-skills-provenance', 'Part 2 (community) — the skill\'s own detail page: real provenance, R3-01\'s approval gate', { key: true });
      },
    },
    {
      id: 'community-skills-approve-palette',
      title: 'Approve at /skills/<id> — then palette-visible in the builder catalog',
      narration:
        'The operator approves on R3-01\'s own surface — never the browser\'s ' +
        '— and only THEN does the skill become a real, draggable chip in the ' +
        'agent-builder catalog: the honest completion of the arc, the trust ' +
        'decision kept outside the browsing surface.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-13] Approve ${CM_SKILL_ID} at /skills/<id> → palette-visible`);
        try {
          await page.locator('[data-action="approve-skill"]').click().catch(() => {});
          await page.waitForFunction(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust') === 'ready', null, { timeout: 10000 }).catch(() => {});
          check(await page.evaluate(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust')) === 'ready',
            'CM-13: approving at /skills/<id> flips trust to ready');
          check(await page.locator('[data-section="approval-gate"]').count() === 0, 'CM-13: the approval gate no longer renders once approved');

          await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
          const chip = page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${CM_SKILL_ID}"]`);
          check(await chip.count() > 0, `CM-13: ${CM_SKILL_ID} IS now a real, draggable chip in the agent-builder catalog`);
          await caption(page, 'Ready to click into any agent from the builder catalog — only after R3-01\'s own approval.');
          await frame(page, 'cm-11-approved-palette', 'Part 2 (community) — approved on R3-01\'s own surface: now palette-visible', { key: true });
        } finally {
          // Both this journey's own artifacts genuinely existed before this
          // sweep — a real cleanup, not a vacuous pass (the standing house
          // rule against a cleanup assertion that would pass either way).
          const skillExisted = existsSync(CM_SKILL_MD_PATH);
          const hookExisted = existsSync(join(CM_HOOK_DIR, 'hook.yaml'));
          check(skillExisted, `CM-13: skills/${CM_SKILL_ID}/SKILL.md genuinely existed before cleanup`);
          check(hookExisted, `CM-13: studio/hooks/${CM_HOOK_ID}/ genuinely existed before cleanup`);
          cleanCommunityArtifacts();
        }
        check(!existsSync(CM_SKILL_DIR), `CM-13: skills/${CM_SKILL_ID}/ removed after the beat (self-cleaning)`);
        check(!existsSync(CM_HOOK_DIR), `CM-13: studio/hooks/${CM_HOOK_ID}/ removed after the beat (self-cleaning)`);
      },
    },
    {
      id: 'community-connections-entry',
      title: 'The /connections shelf — the second browse-community entry point',
      narration:
        'The connections pillar carries its own real browse-community entry ' +
        'point, the same [data-action="browse-community"] link /skills ' +
        'exposes.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-14] The /connections shelf');
        await page.goto(watch.uiUrl + '/connections', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="connection-library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="connection-library"]').count() > 0, 'CM-14: /connections renders');
        check(await page.locator('[data-action="browse-community"]').count() > 0,
          'CM-14: /connections ALSO exposes [data-action="browse-community"] — the same entry point, a second pillar');
        await caption(page, 'External connections — everything agents reach beyond the repo. Adding one browses the same community hubs.');
      },
    },
    {
      id: 'community-connections-browse-entry',
      title: 'Adding a connection means browsing the community hubs',
      narration:
        'Clicking browse-community from /connections lands on the SAME ' +
        '/community shelf the skills arc used — one browser, every kind.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-15] browse-community from /connections → /community');
        await page.locator('[data-action="browse-community"]').click().catch(() => {});
        await page.waitForURL('**/community', { timeout: 10000 }).catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="community-browser"]').count() > 0, 'CM-15: lands on the same /community shelf');
        const real = realTotalCount();
        const dom = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10));
        check(dom === real, `CM-15: the SAME cross-kind total, unfiltered (dom=${dom}, real=${real})`);
        await caption(page, 'Adding a connection means browsing the community hubs — the same shelf, every kind.');
      },
    },
    {
      id: 'community-filter-mcp',
      title: 'Filter to MCP servers (and, in passing, to tools)',
      narration:
        'Filtering to mcp narrows to the catalog\'s 6 curated MCP entries; ' +
        'filtering to tool narrows to its 3 — both independently recomputed ' +
        'off studio/catalog.yaml, satisfying kind filtering for every real ' +
        'kind this browser offers.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log('\n[CM-16] Filter to mcp, then tool');
        await page.locator('[data-action="filter-kind"][data-kind="mcp"]').click().catch(() => {});
        const realMcp = realKindCount('mcp');
        await page.waitForFunction(
          (n) => parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10) === n,
          realMcp, { timeout: 5000 }).catch(() => {});
        const domMcp = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10));
        check(domMcp === realMcp, `CM-16: filtering to mcp narrows to the real catalog count (dom=${domMcp}, real=${realMcp})`);
        const mcpKinds = await page.evaluate(() => [...document.querySelectorAll('[data-card-type="community-item"]')].map((el) => el.getAttribute('data-item-kind')));
        check(mcpKinds.every((k) => k === 'mcp'), 'CM-16: every rendered card is kind="mcp"');
        await frame(page, 'cm-12-filter-mcp', 'Part 2 (community) — kind filtering: mcp', { key: true });

        await page.locator('[data-action="filter-kind"][data-kind="tool"]').click().catch(() => {});
        const realTool = realKindCount('tool');
        await page.waitForFunction(
          (n) => parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10) === n,
          realTool, { timeout: 5000 }).catch(() => {});
        const domTool = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10));
        check(domTool === realTool, `CM-16: filtering to tool narrows to the real catalog count (dom=${domTool}, real=${realTool})`);
        const toolKinds = await page.evaluate(() => [...document.querySelectorAll('[data-card-type="community-item"]')].map((el) => el.getAttribute('data-item-kind')));
        check(toolKinds.every((k) => k === 'tool'), 'CM-16: every rendered card is kind="tool" — kind filtering covers all four real kinds (skill, hook, mcp, tool)');
        await caption(page, 'Sources are explicit — MCP Registry, smithery.ai, modelcontrolprotocol/servers — per kind, per hub.');

        // Back to mcp for the beats that follow.
        await page.locator('[data-action="filter-kind"][data-kind="mcp"]').click().catch(() => {});
        await page.waitForFunction(
          (n) => parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10) === n,
          realMcp, { timeout: 5000 }).catch(() => {});
      },
    },
    {
      id: 'community-mcp-detail-open',
      title: "An MCP's pre-install detail page",
      narration:
        `${CM_MCP_ID}'s community detail page opens with its real install ` +
        'method + exact pin, hub resolution, and provenance — kind-' +
        "appropriate depth, not the server's whole repo.",
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-17] ${CM_MCP_ID}'s pre-install detail page`);
        const real = realMcpEntry(CM_MCP_ID);
        await page.locator(`[data-card-type="community-item"][data-item-id="${CM_MCP_ID}"][data-item-kind="mcp"]`).click().catch(() => {});
        await page.waitForURL(`**/community/mcp/${CM_MCP_ID}`, { timeout: 10000 }).catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="community-detail"]').count() > 0, `CM-17: /community/mcp/${CM_MCP_ID} renders`);
        check(await page.evaluate(() => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-item-kind')) === 'mcp',
          'CM-17: data-item-kind="mcp"');
        check(await page.evaluate(() => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-install-state')) === 'not-installed',
          'CM-17: data-install-state="not-installed" — pre-install');
        const bodyText = await page.evaluate(() => document.body.textContent ?? '');
        check(await page.locator(`[data-section="install"][data-install-method="${real.install.method}"]`).count() > 0,
          `CM-17: [data-section="install"] carries data-install-method="${real.install.method}" — the same vocabulary /connections/[id] uses`);
        const domVersion = await page.evaluate(() => document.querySelector('[data-install-version]')?.getAttribute('data-install-version'));
        check(domVersion === real.install.version, `CM-17: data-install-version is the real pinned version, rendered BEFORE install (dom="${domVersion}", real="${real.install.version}")`);
        check(bodyText.includes(real.install.version), `CM-17: the real pinned version (${real.install.version}) renders`);
        check(bodyText.includes(real.provenance), 'CM-17: the real upstream provenance link renders');
        await caption(page, `${CM_MCP_ID} — the real pin + provenance, before any install exists.`);
        await frame(page, 'cm-13-mcp-detail', 'Part 2 (community) — an MCP\'s pre-install detail page: real pin, real provenance', { key: true });
      },
    },
    {
      id: 'community-mcp-detail-capabilities',
      title: "The MCP's curated capability list",
      narration:
        'The capability list is curation-time data, labelled as such — never ' +
        'presented as a verified live capability list of a running server.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log(`\n[CM-18] ${CM_MCP_ID}'s curated capabilities`);
        const real = realMcpEntry(CM_MCP_ID);
        check(await page.locator('[data-section="capabilities"][data-capabilities-source="curated"]').count() > 0,
          'CM-18: [data-section="capabilities"] carries data-capabilities-source="curated" — labelled, never a verified live list');
        const domCapCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-section="capabilities"]')?.getAttribute('data-capability-count') ?? '-1', 10));
        const realCapCount = (real.capabilities ?? []).length;
        check(domCapCount === realCapCount, `CM-18: data-capability-count matches the catalog's own curated list (dom=${domCapCount}, real=${realCapCount})`);
        await caption(page, 'Kind-appropriate depth: the capabilities it exposes to agents — curated, never claimed as verified.');
        await frame(page, 'cm-14-mcp-capabilities', 'Part 2 (community) — the MCP\'s curated capability list', { key: true });
      },
    },
    {
      id: 'community-mcp-install-suppressed',
      title: 'Install from here — SUPPRESSED, byte-exact argv, state unchanged',
      narration:
        'Clicking Install routes to R3-04\'s real connection pipeline; under ' +
        "this harness's no-spawn bridge the install is SUPPRESSED — the " +
        'byte-exact argv is shown, nothing is executed, and the connection\'s ' +
        'REAL state stays genuinely unchanged (D7 stands here too).',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-19] Install ${CM_MCP_ID} — suppressed`);
        const realAbsent = realMemoryNotInstalledOnDisk();
        check(realAbsent, `CM-19: (sanity) _connections/ genuinely has no ${CM_MCP_ID} package on disk before this beat`);

        const installBtn = page.locator('[data-action="install-community-item"]');
        check((await installBtn.getAttribute('data-install-routed-to')) === 'connection-install',
          'CM-19: data-install-routed-to="connection-install" — routes to R3-04\'s real pipeline');
        await installBtn.click().catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-would-install-argv]') !== null,
          null, { timeout: 15000 }).catch(() => {});
        const outcomeText = await page.evaluate(() => document.querySelector('[data-component="install-outcome"]')?.textContent ?? '');
        check(/Suppressed — no network call was made/.test(outcomeText),
          `CM-19: the outcome reads "Suppressed — no network call was made." (got "${outcomeText.trim().slice(0, 80)}")`);

        const argvText = (await page.evaluate(() => document.querySelector('[data-would-install-argv]')?.textContent ?? '')).trim();
        const expectedArgvText = expectedMemoryInstallArgvText();
        check(argvText === expectedArgvText,
          `CM-19: the shown argv is byte-exact vs. this journey's own independent reconstruction from the catalog pin (got "${argvText}", want "${expectedArgvText}")`);
        await caption(page, 'Suppressed — nothing ran. The argv is shown, never executed.');
        await frame(page, 'cm-15-mcp-suppressed', 'Part 2 (community) — a SUPPRESSED install: byte-exact argv shown, nothing executed', { key: true });

        // The connection's state stays genuinely unchanged — proven THREE
        // ways: the community page's own re-fetched state, a real disk
        // re-check, and (in the closing beats below) the connection's own
        // owning /connections/<id> page.
        await sleep(THINK);
        const stateAfter = await page.evaluate(() => document.querySelector('[data-page="community-detail"]')?.getAttribute('data-install-state'));
        check(stateAfter === 'not-installed', `CM-19: after the suppressed install the community page STILL reads data-install-state="not-installed" (got "${stateAfter}") — never rendered as success`);
        const installBtnStillThere = await page.locator('[data-action="install-community-item"]').count();
        check(installBtnStillThere === 1, 'CM-19: the Install control is STILL rendered — the "already installed" branch never fires, because nothing was ever installed');
        const stillAbsentOnDisk = realMemoryNotInstalledOnDisk();
        check(stillAbsentOnDisk, 'CM-19: (cross-check) the connections root genuinely still has nothing installed');
      },
    },
    {
      id: 'community-return-to-browser',
      title: 'Back to the browser',
      narration: 'Returning to the unfiltered /community shelf — the same real total, unchanged by the suppressed install attempt.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-20] Back to the browser');
        await page.goto(watch.uiUrl + '/community', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="community-browser"]').count() > 0, 'CM-20: back on /community');
        const real = realTotalCount();
        const dom = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="community-browser"]')?.getAttribute('data-item-count') ?? '-1', 10));
        check(dom === real, `CM-20: the total is unchanged by the suppressed install attempt (dom=${dom}, real=${real})`);
        await caption(page, 'Back to the browser — unchanged.');
      },
    },
    {
      id: 'community-connections-local-shelf',
      title: 'The local connections shelf — the real state, still true',
      narration:
        `Back on the OWNING /connections shelf, ${CM_MCP_ID} still reads ` +
        'not-installed — the suppressed install attempt left the real local ' +
        'shelf genuinely untouched, health-checked against a real re-probe.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-21] /connections — ${CM_MCP_ID}'s real state, still true`);
        await page.goto(watch.uiUrl + '/connections', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="connection-library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        const card = page.locator(`[data-card-type="connection"][data-connection-id="${CM_MCP_ID}"]`);
        check(await card.count() > 0, `CM-21: ${CM_MCP_ID} is listed on the real /connections shelf`);
        const domState = await card.getAttribute('data-connection-state');
        check(domState === 'not-installed', `CM-21: data-connection-state="not-installed" — the community browser's suppressed install left this genuinely unchanged (got "${domState}")`);
        const realAbsent = realMemoryNotInstalledOnDisk();
        check(realAbsent, '(cross-check) still absent on disk — health-checked, not just re-read from a cache');
        await caption(page, `${CM_MCP_ID} — still not-installed. Health-checked, provenance kept, exactly as before the browser was ever opened.`);
        await frame(page, 'cm-16-connections-local-shelf', 'Part 2 (community) — the local connections shelf: the real state, still true', { key: true });
      },
    },
    {
      id: 'community-connections-used-by',
      title: 'Used-by — agents reference connections by name, nothing else to wire',
      narration:
        `${CM_MCP_ID}'s own detail page still carries the SAME derived used-` +
        'by section R3-04 shipped — agents that reference a connection do so ' +
        'by composition.mcps, never a declared list, and the community ' +
        'browser adds nothing new to wire.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log(`\n[CM-22] /connections/${CM_MCP_ID} — derived used-by`);
        await page.goto(watch.uiUrl + `/connections/${CM_MCP_ID}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="connection-detail"]').count() > 0, `CM-22: /connections/${CM_MCP_ID} renders`);
        check(await page.locator('[data-section="used-by"]').count() > 0, 'CM-22: [data-section="used-by"] renders — DERIVED, never declared');
        const usedByCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-section="used-by"]')?.getAttribute('data-used-by-count') ?? '-1', 10));
        check(usedByCount >= 0, `CM-22: data-used-by-count is a real, non-negative derived scan (got ${usedByCount})`);
        const stateAfter = await page.evaluate(() => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-connection-state'));
        check(stateAfter === 'not-installed', `CM-22: on its own owning page, ${CM_MCP_ID} STILL reads not-installed — the browser never wired a fact the pipeline didn't (got "${stateAfter}")`);
        await caption(page, 'Agents reference it by name in their specs — nothing else to wire.');
        await frame(page, 'cm-17-connections-used-by', 'Part 2 (community) — used-by is derived; nothing else to wire', { key: true });
      },
    },
    {
      id: 'community-refresh-kickoff',
      title: 'The refresh entry — kicks off the community-refresh agent\'s kickoff page',
      narration:
        'W6-CR-3: the registry never fetches itself — an operator asks for a ' +
        'verified pass via [data-action="refresh-community-registry"] on the ' +
        'browser itself, landing on the SAME generic session-kickoff surface ' +
        'every other interactive kind uses (B6), just with no project/KB ' +
        'selector to fill in — the community registry is forge\'s own single, ' +
        'forge-wide file. This beat proves the entry point and the kickoff ' +
        'page render correctly; it deliberately never clicks Start — no live ' +
        'agent spawn belongs in a gate.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[CM-23] /community → refresh entry → session-kickoff');
        await page.goto(watch.uiUrl + '/community', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="community-browser"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('[data-action="refresh-community-registry"]').count() > 0,
          'CM-23: /community exposes [data-action="refresh-community-registry"] — the entry point into the refresh agent\'s kickoff');

        await page.locator('[data-action="refresh-community-registry"]').click().catch(() => {});
        await page.waitForURL('**/sessions/community-refresh/new', { timeout: 10000 }).catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="session-kickoff"]').count() > 0, 'CM-23: /sessions/community-refresh/new renders [data-page="session-kickoff"]');
        const kindChip = await page.evaluate(() => document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-kickoff-kind'));
        check(kindChip === 'community-refresh', `CM-23: the kickoff page's own kind chip reads "community-refresh" (got "${kindChip}")`);
        check(await page.locator('[data-section="kickoff-context"]').count() > 0, 'CM-23: the context card renders (agent, produces, session directory)');
        check(await page.locator('[data-section="kickoff-selector"]').count() === 0,
          'CM-23: NO project/KB selector renders — community-refresh is the one kind with selector:"none" (nothing forge-wide to pick)');
        check(await page.locator('[data-action="start-session"]').count() > 0, 'CM-23: the Start button is present — never clicked in this gate (no live agent spawn)');
        await caption(page, 'Just Start + a model tier — the registry is forge\'s own, nothing to select.');
        await frame(page, 'cm-23-community-refresh-kickoff', 'Part 2 (community) — the refresh agent\'s kickoff page, unattended-safe', { key: true });
      },
    },
  ],
});
