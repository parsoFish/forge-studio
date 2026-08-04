import { readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { FORGE_ROOT, caption, THINK, waitForFile } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// ── R3-04 helpers: real, disk/exec-derived cross-checks ─────────────────────
// Mirrors templates.mjs's own precedent exactly (its module header: "These
// independently recompute what [the server module] derives server-side...
// mirroring skills.mjs's own realSkillUsage precedent: the point of every
// beat that calls these is a genuine cross-check against reality, not a
// re-read of whatever the product's own response already claims"). For
// connections the "reality" a beat cross-checks is threefold: the catalog's
// own structure (parsed straight off studio/catalog.yaml, never via the
// bridge), a REAL exec (`git --version`, run by this script, not by the
// product), and REAL disk absence (`_connections/` never populated — D7
// forbids this journey from ever running a network install, so a
// not-installed npm entry stays independently verifiable by its own
// package.json simply not existing).

function loadCatalogDoc() {
  return yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'catalog.yaml'), 'utf8'));
}

/** Real total connection-library size: every `tools:` + `mcps:` entry,
 *  counted straight off disk — mirrors template-library.ts's union count via
 *  templates.mjs's realTemplateCounts() precedent. Never a hand-bumped
 *  literal — a curated entry added/removed changes this number the same
 *  render it changes the product's own count. */
function realConnectionTotal() {
  const doc = loadCatalogDoc();
  return (doc.tools?.length ?? 0) + (doc.mcps?.length ?? 0);
}

/** The `memory` MCP's own catalog-declared install pin + capability list —
 *  read directly off disk so the detail-page assertions below (pin shown,
 *  capability count, byte-exact install argv) are checked against the
 *  curated SOURCE, never against a re-read of the bridge's own response. */
function realMemoryCatalogEntry() {
  const doc = loadCatalogDoc();
  const entry = (doc.mcps ?? []).find((m) => m.id === 'memory');
  if (!entry) throw new Error('connections journey: "memory" is missing from studio/catalog.yaml mcps: — the journey\'s fixtures assume it exists');
  return entry;
}

/** Real, independently-EXECUTED probe for `git` — this script spawns the
 *  same command the product's own probe would spawn, on its own, and reads
 *  the real exit code — never trusting the DOM's own claim that git is
 *  available (D4's "a pure state machine that is green while the real
 *  runner is broken" failure mode, guarded against from the demo side too). */
function realGitProbeAvailable() {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf8' });
    return /git version/i.test(out);
  } catch {
    return false;
  }
}

/** Real, independent DISK check that `memory` is NOT installed under the
 *  connections root — reads the exact path connection-probe.ts's
 *  probeNpmPackage would read (`_connections/node_modules/<pkg>/package.json`),
 *  computed here from the catalog's own declared package name so a future
 *  pin/package rename cannot silently desync this check from reality. D7:
 *  this journey never runs an install for real, so this MUST read false —
 *  if it ever reads true, either a network install leaked into the repo
 *  checkout or a different suite polluted `_connections/`, and this check
 *  existing is what would catch it. */
function realMemoryNotInstalledOnDisk() {
  const entry = realMemoryCatalogEntry();
  const pkgJsonPath = join(FORGE_ROOT, '_connections', 'node_modules', ...entry.install.package.split('/'), 'package.json');
  return !existsSync(pkgJsonPath);
}

/** The byte-exact install argv D6 specifies, reconstructed independently
 *  from the catalog's own pin (never from the product's response) —
 *  `npm install --prefix <connectionsRoot> --ignore-scripts --no-audit
 *  --no-fund --save-exact <pkg>@<version>`, rendered the same way the detail
 *  page renders `data-would-install-argv`'s text content
 *  (`${command} ${args.join(' ')}`). */
function expectedMemoryInstallArgvText() {
  const entry = realMemoryCatalogEntry();
  const connectionsRoot = resolve(FORGE_ROOT, '_connections');
  const args = [
    'install', '--prefix', connectionsRoot, '--ignore-scripts', '--no-audit', '--no-fund',
    '--save-exact', `${entry.install.package}@${entry.install.version}`,
  ];
  return `npm ${args.join(' ')}`;
}

// ── CONN-4 fixtures: a self-contained scratch agent (own create + cleanup,
// no stash/restore of a real shipped skill — see the F3 beat's own header
// note on why this shape was chosen over hooks-bind's stash/restore
// precedent). Disjoint from every other journey's scratch ids. ────────────
const CONN_SCRATCH_SLUG = 'journey-connections-scratch';
const CONN_SCRATCH_NAME = 'Journey Connections Scratch';
const CONN_SCRATCH_DIR = join(FORGE_ROOT, 'skills', CONN_SCRATCH_SLUG);
const CONN_SCRATCH_SKILL_PATH = join(CONN_SCRATCH_DIR, 'SKILL.md');
function cleanConnScratchAgent() {
  try { rmSync(CONN_SCRATCH_DIR, { recursive: true, force: true }); } catch { /* */ }
}

/** HTML5 DataTransfer DnD helper (agent-builder catalog → drop zone),
 *  generic over `kind` — mirrors agents.mjs's own dragSkillChipIntoZone /
 *  hooks.mjs's own dragChipIntoZone. Kept LOCAL here (not shared) for the
 *  same reason those two keep their own copies: binding is each journey's
 *  own concern (index.mjs's per-journey ordering comment). */
async function dragChipIntoZone(page, id, kind) {
  const chip = page.locator(`.catalog-chip[data-id="${id}"][data-kind="${kind}"]`);
  const zone = page.locator(`[data-accepts="${kind}"]`);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await chip.dispatchEvent('dragstart', { dataTransfer });
  await zone.dispatchEvent('dragover', { dataTransfer });
  await zone.dispatchEvent('drop', { dataTransfer });
  await chip.dispatchEvent('dragend', { dataTransfer });
}

export const journey = defineJourney({
  id: 'connections',
  title: 'Browse, install, and gate on connections',
  story:
    'As an operator, I browse the /connections library — curated tools and MCP ' +
    'servers read straight from studio/catalog.yaml, with REAL per-entry probe ' +
    'states, cross-checked here against exec/disk reality rather than the ' +
    "product's own claims — open a system-provided tool's detail page (no " +
    "install action exists), open an MCP's detail page (curated capabilities " +
    'labelled as such, pin + provenance shown, an install that the dry-bridge ' +
    'correctly SUPPRESSES — never rendered as success — and a real re-probe ' +
    'afterward), then bind that still-not-installed MCP onto a brand-new agent ' +
    'to prove the readiness panel and the Run control both block on it, naming ' +
    'it by id and state rather than a generic "not ready".',
  beats: [
    {
      id: 'connections-library',
      title: 'The /connections shelf — real probe states, disk/exec cross-checked',
      narration:
        'The connections library lists every curated tool and MCP server, with ' +
        'a readiness summary derived from REAL per-entry probes (never a ' +
        'declared status) — the shelf\'s total count and two of its per-card ' +
        'states are independently recomputed here: the total straight off ' +
        'studio/catalog.yaml, git\'s "available" by this script running its ' +
        'own `git --version`, and memory\'s "not-installed" by this script ' +
        'checking the connections root\'s own node_modules on disk.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── CONN-0: the /connections shelf ───────────────────────────────────────
        console.log('\n[CONN-0] The /connections shelf');
        await page.goto(watch.uiUrl + '/connections', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="connection-library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="connection-library"]').count() > 0, 'CONN-0: /connections renders [data-page="connection-library"]');
        await caption(page, 'The connections library — curated tools and MCP servers, read straight from studio/catalog.yaml, readiness always REAL-probed.');

        // Total count — independently recomputed off disk (never a re-read of
        // what the shelf's own response claims), mirroring templates.mjs's
        // realTemplateCounts precedent exactly.
        const realTotal = realConnectionTotal();
        const domTotal = await page.evaluate(() =>
          parseInt(document.querySelector('[data-page="connection-library"]')?.getAttribute('data-connection-count') ?? '-1', 10));
        check(domTotal === realTotal, `CONN-0: data-connection-count matches studio/catalog.yaml's tools:+mcps: total (dom=${domTotal}, real=${realTotal})`);

        const domCardCount = await page.evaluate(() => document.querySelectorAll('[data-card-type="connection"]').length);
        check(domCardCount === realTotal, `CONN-0: one rendered card per real catalog entry (${domCardCount} vs ${realTotal})`);

        // Readiness summary — a structural invariant (available + not-installed
        // + misconfigured === total) plus a floor on the two states this beat
        // independently verifies below (never a pinned exact number — gh/other
        // entries' real state varies by environment).
        const counts = await page.evaluate(() => {
          const root = document.querySelector('[data-page="connection-library"]');
          return {
            available: parseInt(root?.getAttribute('data-available-count') ?? '-1', 10),
            notInstalled: parseInt(root?.getAttribute('data-not-installed-count') ?? '-1', 10),
            misconfigured: parseInt(root?.getAttribute('data-misconfigured-count') ?? '-1', 10),
          };
        });
        check(counts.available + counts.notInstalled + counts.misconfigured === realTotal,
          `CONN-0: available+not-installed+misconfigured sums to the real total (${counts.available}+${counts.notInstalled}+${counts.misconfigured} vs ${realTotal})`);

        // git — a REAL, executed cross-check (this script spawns git itself).
        const realGitAvailable = realGitProbeAvailable();
        check(realGitAvailable, 'CONN-0: (sanity) this script\'s own `git --version` succeeds — git must be on PATH for this beat to mean anything');
        const gitCard = page.locator('[data-card-type="connection"][data-connection-id="git"]');
        check(await gitCard.count() > 0, 'CONN-0: the git tool is listed');
        const gitDomState = await gitCard.getAttribute('data-connection-state');
        const gitDomKind = await gitCard.getAttribute('data-connection-kind');
        check(gitDomKind === 'tool', `CONN-0: git's data-connection-kind="tool" (got "${gitDomKind}")`);
        check(gitDomState === 'available', `CONN-0: git reads "available" — cross-checked against this script's own real \`git --version\` exec (dom="${gitDomState}", real exec ok=${realGitAvailable})`);

        // memory — a REAL, disk-derived cross-check (this script reads the
        // connections root itself, never the bridge's claim).
        const realMemoryAbsent = realMemoryNotInstalledOnDisk();
        check(realMemoryAbsent, 'CONN-0: (sanity) _connections/ genuinely has no memory package on disk — D7 forbids this journey from ever installing for real');
        const memoryCard = page.locator('[data-card-type="connection"][data-connection-id="memory"]');
        check(await memoryCard.count() > 0, 'CONN-0: the memory MCP is listed');
        const memoryDomState = await memoryCard.getAttribute('data-connection-state');
        const memoryDomKind = await memoryCard.getAttribute('data-connection-kind');
        check(memoryDomKind === 'mcp', `CONN-0: memory's data-connection-kind="mcp" (got "${memoryDomKind}")`);
        check(memoryDomState === 'not-installed', `CONN-0: memory reads "not-installed" — cross-checked against this script's own real disk check (dom="${memoryDomState}", real absent=${realMemoryAbsent})`);

        await frame(page, 'conn-0-shelf', 'Part 2 (connections) — the /connections shelf: real probe states, disk/exec cross-checked', { key: true });

        // Search narrows to the one real match (case-insensitive, name+desc).
        await page.locator('[data-field="connection-search"]').fill('memory').catch(() => {});
        await page.waitForFunction(
          () => parseInt(document.querySelector('[data-page="connection-library"]')?.getAttribute('data-connection-count') ?? '-1', 10) === 1,
          null, { timeout: 5000 }).catch(() => {});
        const filteredIds = await page.evaluate(() =>
          [...document.querySelectorAll('[data-card-type="connection"]')].map((el) => el.getAttribute('data-connection-id')));
        check(filteredIds.length === 1 && filteredIds[0] === 'memory', `CONN-0: searching "memory" narrows to exactly the one real match (got [${filteredIds.join(', ')}])`);
        await page.locator('[data-field="connection-search"]').fill('').catch(() => {});
      },
    },
    {
      id: 'connections-detail-tool',
      title: "A system-provided tool's detail page — no install action exists",
      narration:
        'git\'s detail page shows it as system-provided and available, with NO ' +
        'install control at all — structurally absent, not styled away — and ' +
        'real probe evidence (the actual captured `git --version` output). ' +
        'Used-by is DERIVED from real agent composition, not declared: ' +
        'developer-ralph really does bind git in its shipped SKILL.md.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── CONN-1: git's detail page (system-provided, no install action) ──────
        console.log("\n[CONN-1] git's detail page (/connections/git)");
        await page.goto(watch.uiUrl + '/connections/git', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="connection-detail"]').count() > 0, 'CONN-1: /connections/git renders [data-page="connection-detail"]');
        check(await page.evaluate(() => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-connection-kind')) === 'tool',
          'CONN-1: data-connection-kind="tool"');
        check(await page.evaluate(() => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-connection-installable')) === 'false',
          'CONN-1: data-connection-installable="false" — D13: system-provided has no forge-driven install path');

        check(await page.locator('[data-section="install"][data-install-method="system-provided"][data-install-action="none"]').count() > 0,
          'CONN-1: [data-section="install"] reads data-install-method="system-provided" data-install-action="none"');
        check(await page.locator('[data-action="install-connection"]').count() === 0,
          'CONN-1: [data-action="install-connection"] does not render AT ALL for a system-provided entry (F2 AC — structural absence, not a disabled button)');
        await caption(page, 'git — system-provided, available, no install action anywhere on the page.');

        check(await page.locator('[data-section="probe-evidence"][data-probe-state="available"]').count() > 0,
          'CONN-1: [data-section="probe-evidence"] reads data-probe-state="available"');
        const stdout = await page.evaluate(() => document.querySelector('[data-probe-stdout]')?.textContent ?? '');
        check(/git version/i.test(stdout), `CONN-1: the real captured \`git --version\` stdout is shown verbatim (got "${stdout.trim().slice(0, 60)}")`);

        const usedByCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-section="used-by"]')?.getAttribute('data-used-by-count') ?? '-1', 10));
        check(usedByCount >= 1, `CONN-1: git's used-by is DERIVED and non-empty — developer-ralph really binds it in its shipped SKILL.md (data-used-by-count=${usedByCount})`);
        check(await page.locator('[data-used-by-agent="developer-ralph"]').count() > 0,
          'CONN-1: developer-ralph is named as a real carrier (composition.tools, not a declared list)');
        await frame(page, 'conn-1-git-detail', 'Part 2 (connections) — git\'s detail page: no install action, real probe evidence, derived used-by', { key: true });
      },
    },
    {
      id: 'connections-detail-mcp',
      title: 'An MCP\'s detail page — curated capabilities, a SUPPRESSED install, a real re-probe',
      narration:
        'memory\'s detail page shows an npm install control, its exact pinned ' +
        'version, real upstream provenance, and its capability list labelled ' +
        '"curated" — never presented as a verified live capability list. ' +
        'Clicking Install under this journey\'s FORGE_ARCHITECT_NO_SPAWN=1 ' +
        'bridge correctly SUPPRESSES the install (argv shown, nothing executed) ' +
        'and the connection stays not-installed — a suppressed install is never ' +
        'allowed to render as success. A subsequent real re-probe confirms the ' +
        'same true state.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── CONN-2: memory's detail page (npm, capabilities, suppressed install) ──
        console.log("\n[CONN-2] memory's detail page (/connections/memory)");
        const realEntry = realMemoryCatalogEntry();

        await page.goto(watch.uiUrl + '/connections/memory', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 }).catch(() => {});
        check(await page.locator('main[data-page="connection-detail"]').count() > 0, 'CONN-2: /connections/memory renders [data-page="connection-detail"]');
        check(await page.evaluate(() => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-connection-kind')) === 'mcp',
          'CONN-2: data-connection-kind="mcp"');
        check(await page.evaluate(() => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-connection-installable')) === 'true',
          'CONN-2: data-connection-installable="true" (npm method — D13)');

        // Install control present + exact pin, cross-checked against the
        // catalog's OWN declared pin (never against the page's own claim).
        check(await page.locator('[data-section="install"][data-install-method="npm"][data-install-action="available"]').count() > 0,
          'CONN-2: [data-section="install"] reads data-install-method="npm" data-install-action="available"');
        check(await page.locator('[data-action="install-connection"]').count() === 1,
          'CONN-2: exactly one [data-action="install-connection"] renders (installable entry)');
        const domVersion = await page.evaluate(() => document.querySelector('[data-install-version]')?.getAttribute('data-install-version'));
        check(domVersion === realEntry.install.version, `CONN-2: the pin shown matches the catalog's own exact version (dom="${domVersion}", real="${realEntry.install.version}")`);
        const provenanceText = await page.evaluate(() => document.querySelector('[data-section="install"]')?.textContent ?? '');
        check(provenanceText.includes(realEntry.provenance), 'CONN-2: real upstream provenance is shown on the page');
        await caption(page, `memory — npm install, pinned to exactly ${realEntry.install.version}, real upstream provenance shown.`);

        // Capabilities — curated, labelled as such, count cross-checked
        // against the catalog's own declared list (never the page's own claim).
        check(await page.locator('[data-section="capabilities"][data-capabilities-source="curated"]').count() > 0,
          'CONN-2: [data-section="capabilities"] carries data-capabilities-source="curated" — labelled, never presented as a verified live list (D8)');
        const domCapCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-section="capabilities"]')?.getAttribute('data-capability-count') ?? '-1', 10));
        check(domCapCount === realEntry.capabilities.length,
          `CONN-2: data-capability-count matches the catalog's own curated list (dom=${domCapCount}, real=${realEntry.capabilities.length})`);

        // Config — NAMES only, the optional MEMORY_FILE_PATH reads "unchecked"
        // (D5: an optional var's presence is never probed, stated not guessed).
        check(await page.locator('[data-config-env="MEMORY_FILE_PATH"][data-config-required="false"][data-config-status="unchecked"]').count() > 0,
          'CONN-2: MEMORY_FILE_PATH (optional) reads data-config-status="unchecked" — never a guessed set/unset');
        await frame(page, 'conn-2-memory-detail', 'Part 2 (connections) — memory\'s detail page: npm install, curated capabilities, config by NAME', { key: true });

        // ── THE SUPPRESSED INSTALL (D7) — never rendered as success ─────────────
        await page.locator('[data-action="install-connection"]').click().catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-component="install-outcome"]') !== null,
          null, { timeout: 15000 }).catch(() => {});
        const outcomeStatus = await page.evaluate(() => document.querySelector('[data-component="install-outcome"]')?.getAttribute('data-install-outcome-status'));
        check(outcomeStatus === 'suppressed', `CONN-2: FORGE_ARCHITECT_NO_SPAWN=1 suppresses the install — data-install-outcome-status="suppressed" (got "${outcomeStatus}"), NEVER "installed"`);

        const argvText = (await page.evaluate(() => document.querySelector('[data-would-install-argv]')?.textContent ?? '')).trim();
        const expectedArgvText = expectedMemoryInstallArgvText();
        check(argvText === expectedArgvText,
          `CONN-2: the shown argv is byte-exact vs. this script's own independent reconstruction from the catalog pin (got "${argvText}", want "${expectedArgvText}")`);
        await caption(page, 'Suppressed — nothing ran. The argv is shown, never executed, and the connection stays not-installed.');
        await frame(page, 'conn-3-suppressed-install', 'Part 2 (connections) — a SUPPRESSED install: argv shown, nothing executed, never rendered as success', { key: true });

        const stateAfterInstall = await page.evaluate(() => document.querySelector('[data-page="connection-detail"]')?.getAttribute('data-connection-state'));
        check(stateAfterInstall === 'not-installed', `CONN-2: after the suppressed install the connection STILL reads "not-installed" (got "${stateAfterInstall}") — a suppressed install never flips state`);

        // ── A REAL re-probe — genuinely re-executed, still the true state ───────
        await page.locator('[data-action="probe-connection"]').click().catch(() => {});
        await sleep(THINK);
        await page.waitForFunction(
          () => document.querySelector('[data-section="probe-evidence"]')?.getAttribute('data-probe-state') === 'not-installed',
          null, { timeout: 10000 }).catch(() => {});
        const reprobedState = await page.evaluate(() => document.querySelector('[data-section="probe-evidence"]')?.getAttribute('data-probe-state'));
        check(reprobedState === 'not-installed', `CONN-2: an explicit re-probe re-executes for real and reports the same true state (got "${reprobedState}")`);
        const stillAbsentOnDisk = realMemoryNotInstalledOnDisk();
        check(stillAbsentOnDisk, 'CONN-2: (cross-check) the connections root genuinely still has nothing installed — the re-probe was not fed a stale/cached answer');
      },
    },
    {
      id: 'connections-readiness-block',
      title: 'F3 — the readiness panel and Run both block on a not-ready connection',
      narration:
        'A brand-new agent binds the still-not-installed memory MCP from the ' +
        'catalog. Its readiness panel gains a real "connections" check that ' +
        'reads NOT ready, and its Run control is blocked with a message that ' +
        'NAMES the component and its state — never a generic "agent not ' +
        'ready" — mirroring the same block orchestrator/run-agent.ts and the ' +
        'bridge run route enforce pre-spawn (pinned by node --test ATs; this ' +
        'beat is the UI layer of the same rule).',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        // ── CONN-3: readiness panel + Run block on an unready bound MCP ─────────
        console.log('\n[CONN-3] Readiness panel + Run block on an unready bound MCP');
        cleanConnScratchAgent(); // stale-state sweep first (crash-safe, this journey's own artifact only)

        try {
          await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(
            () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 }).catch(() => {});
          check(await page.locator('[data-starter-option="blank"]').count() > 0, 'CONN-3: the starter picker offers a genuine "blank" option');
          await page.locator('[data-starter-option="blank"]').click();
          await page.waitForSelector('#purpose-input', { timeout: 10000 });
          await page.locator('input.agent-name-input').fill(CONN_SCRATCH_NAME);
          await page.locator('#purpose-input').fill('Journey-only scratch agent — proves the connections readiness block, never run for real.');
          await sleep(THINK);

          await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
          await page.waitForFunction(
            () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
            null, { timeout: 5000 }).catch(() => {});

          const chipPresent = await page.evaluate(() =>
            document.querySelector('[data-component="catalog-palette"] .catalog-chip[data-id="memory"][data-kind="mcp"]') !== null);
          check(chipPresent, 'CONN-3: memory is a real, draggable [data-kind="mcp"] catalog chip');
          await dragChipIntoZone(page, 'memory', 'mcp');
          const mcpZoneCount = await page.evaluate(() => document.querySelector('[data-accepts="mcp"]')?.getAttribute('data-count') ?? '0');
          check(mcpZoneCount === '1', `CONN-3: dragging memory into the mcp drop zone lands it (data-count="${mcpZoneCount}")`);
          await caption(page, 'A brand-new agent binds the still-not-installed memory MCP.');
          await frame(page, 'conn-4-scratch-bound', 'Part 2 (connections) — a brand-new agent binds the not-installed memory MCP', { key: true });

          await page.locator('[data-action="save-agent"]').click().catch(() => {});
          const landed = await waitForFile(CONN_SCRATCH_SKILL_PATH, 12000);
          check(landed, `CONN-3: saving writes skills/${CONN_SCRATCH_SLUG}/SKILL.md`);
          const savedText = landed ? readFileSync(CONN_SCRATCH_SKILL_PATH, 'utf8') : '';
          check(savedText.includes('memory'), 'CONN-3: the saved SKILL.md persists the memory MCP binding');

          await page.waitForURL(`**/agents/${CONN_SCRATCH_SLUG}`, { timeout: 10000 }).catch(() => {});
          await page.waitForFunction(
            () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 }).catch(() => {});
          await page.waitForFunction(
            () => document.querySelector('[data-check="connections"]') !== null,
            null, { timeout: 15000 }).catch(() => {});

          const connCheck = page.locator('[data-check="connections"]');
          check(await connCheck.count() > 0, 'CONN-3: the readiness panel gains a real "connections" check once the connections library resolves');
          const connCheckClass = (await connCheck.getAttribute('class')) ?? '';
          check(!connCheckClass.includes(' ok'), `CONN-3: the connections check reads NOT ready (class="${connCheckClass}")`);
          const connCheckTitle = (await connCheck.getAttribute('title')) ?? '';
          check(connCheckTitle.includes('mcp "memory" (not-installed)'),
            `CONN-3: the check's own detail names the component and its state, not "agent not ready" (title="${connCheckTitle}")`);

          const readyCount = await page.evaluate(() => parseInt(document.querySelector('#readiness-list')?.getAttribute('data-ready-count') ?? '-1', 10));
          const totalChecks = await page.evaluate(() => document.querySelectorAll('[data-check]').length);
          check(readyCount < totalChecks, `CONN-3: [data-ready-count] excludes the unready connections check (ready=${readyCount}, total=${totalChecks})`);

          await page.waitForFunction(
            () => document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-blocked') !== null,
            null, { timeout: 10000 }).catch(() => {});
          check(await page.locator('[data-section="agent-run"][data-run-dispatchable="true"]').count() > 0,
            'CONN-3: the scratch agent is non-interactive — the dispatchable Run panel (not the interactive-session stub) renders');
          const runBlocked = await page.evaluate(() => document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-blocked'));
          check(runBlocked === 'true', `CONN-3: [data-section="agent-run"] reads data-run-blocked="true" (got "${runBlocked}")`);
          const blockMsg = await page.evaluate(() => document.querySelector('[data-component="connection-run-block"]')?.textContent ?? '');
          check(blockMsg.includes('mcp "memory" (not-installed)'), `CONN-3: the blocked-Run message NAMES the component and its state (got "${blockMsg.trim()}")`);
          check(await page.locator('[data-action="run-agent"]').isDisabled().catch(() => false), 'CONN-3: the Run button itself is disabled while blocked');
          await caption(page, 'Blocked — named, never generic: "mcp \\"memory\\" (not-installed)". Same rule the pre-spawn seam and the bridge run route enforce.');
          await frame(page, 'conn-5-run-blocked', 'Part 2 (connections) — readiness NOT ready + Run blocked, both naming the component', { key: true });
        } finally {
          cleanConnScratchAgent();
        }
        check(!existsSync(CONN_SCRATCH_DIR), `CONN-3: skills/${CONN_SCRATCH_SLUG}/ removed after the beat (self-cleaning)`);
      },
    },
  ],
});
