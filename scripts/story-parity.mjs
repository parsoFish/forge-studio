#!/usr/bin/env node
/**
 * story-parity.mjs — CLI entrypoint for the R7-02-F3 story-beat parity view.
 *
 * Loads the three REAL sources — the committed story registry
 * (scripts/journeys/story-registry.mjs), the real journey harness
 * (scripts/journeys/index.mjs), and the studio end-state mockup source
 * (mockups/studio-endstate-v2/journeys-data.jsx) — and prints the derived
 * parity report, or with --json the raw parity object. Exits 1 whenever
 * parity.errors is non-empty, INCLUDING the "registry module doesn't exist
 * yet" case: that must never look like success (exit 0).
 *
 * All paths are resolved from this module's own location via
 * fileURLToPath(import.meta.url) — never process.cwd() — because this repo
 * has a recorded cwd-sensitivity trap (a harness invoked from the wrong
 * working directory must not silently read the wrong files).
 *
 * Usage:
 *   node scripts/story-parity.mjs           # human-readable report (stdout)
 *   node scripts/story-parity.mjs --json    # JSON parity object (stdout)
 *
 * Exit codes: 0 clean, 1 parity errors (or a real source failed to load —
 * that must never look like success), 2 bad CLI usage (unrecognised flag).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseMockupStories, deriveParity, formatParityReport } from './lib/story-parity.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(__filename);
const REPO_ROOT = join(SCRIPTS_DIR, '..');
const REGISTRY_PATH = join(SCRIPTS_DIR, 'journeys', 'story-registry.mjs');
const JOURNEYS_INDEX_PATH = join(SCRIPTS_DIR, 'journeys', 'index.mjs');
const MOCKUP_SOURCE_PATH = join(REPO_ROOT, 'mockups', 'studio-endstate-v2', 'journeys-data.jsx');
const USAGE = 'usage: story-parity.mjs [--json]';

/**
 * Dynamically import a module by absolute filesystem path. Converts to a
 * file:// URL first — required cross-platform for dynamic import(), and
 * keeps resolution anchored to the computed absolute path rather than any
 * relative specifier that could be read against process.cwd().
 * @param {string} absolutePath
 */
async function importByPath(absolutePath) {
  return import(pathToFileURL(absolutePath).href);
}

/**
 * Parse CLI argv explicitly. The only recognised flag is `--json`; anything
 * else (a typo like `--jsonnn`, a different case, `--help`, a stray
 * positional) is rejected rather than silently ignored — an unrecognised
 * argument must never fall through to the default report with exit 0.
 * @param {string[]} argv full `process.argv`
 * @returns {{ jsonMode: boolean }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let jsonMode = false;
  for (const arg of args) {
    if (arg === '--json') {
      jsonMode = true;
    } else {
      throw new Error(`story-parity: unrecognised argument "${arg}"\n${USAGE}`);
    }
  }
  return { jsonMode };
}

async function main() {
  let jsonMode;
  try {
    ({ jsonMode } = parseArgs(process.argv));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
    return;
  }

  let STORY_REGISTRY;
  try {
    ({ STORY_REGISTRY } = await importByPath(REGISTRY_PATH));
  } catch (err) {
    console.error(
      `story-parity: could not load the story registry at ${REGISTRY_PATH} ` +
        `(has R7-02-F3's scripts/journeys/story-registry.mjs landed yet?): ${err.message}`,
    );
    process.exit(1);
    return;
  }
  if (!Array.isArray(STORY_REGISTRY)) {
    console.error(`story-parity: ${REGISTRY_PATH} does not export an array STORY_REGISTRY`);
    process.exit(1);
    return;
  }

  let JOURNEYS;
  let RUN_ORDER;
  try {
    ({ JOURNEYS, RUN_ORDER } = await importByPath(JOURNEYS_INDEX_PATH));
  } catch (err) {
    console.error(`story-parity: could not load the journey harness at ${JOURNEYS_INDEX_PATH}: ${err.message}`);
    process.exit(1);
    return;
  }
  if (!Array.isArray(JOURNEYS)) {
    console.error(`story-parity: ${JOURNEYS_INDEX_PATH} does not export an array JOURNEYS`);
    process.exit(1);
    return;
  }
  if (!Array.isArray(RUN_ORDER)) {
    console.error(`story-parity: ${JOURNEYS_INDEX_PATH} does not export an array RUN_ORDER`);
    process.exit(1);
    return;
  }

  let mockupSource;
  try {
    mockupSource = readFileSync(MOCKUP_SOURCE_PATH, 'utf8');
  } catch (err) {
    console.error(`story-parity: could not read the mockup source at ${MOCKUP_SOURCE_PATH}: ${err.message}`);
    process.exit(1);
    return;
  }

  let mockupStories;
  try {
    mockupStories = parseMockupStories(mockupSource);
  } catch (err) {
    console.error(`story-parity: ${err.message}`);
    process.exit(1);
    return;
  }

  const parity = deriveParity({
    registry: STORY_REGISTRY,
    mockupStories,
    journeys: JOURNEYS,
    runOrder: RUN_ORDER,
  });

  if (jsonMode) {
    // parity is plain arrays/objects only (no Set/Map leaks) — safe to
    // serialize directly.
    console.log(JSON.stringify(parity, null, 2));
  } else {
    console.log(formatParityReport(parity));
  }

  if (parity.errors.length > 0) {
    for (const err of parity.errors) console.error(err);
    process.exit(1);
    return;
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`story-parity: unexpected failure: ${err.stack ?? err.message}`);
  process.exit(1);
});
