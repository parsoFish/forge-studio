/**
 * Shared support for the `bridge-studio-kbs` integration suite.
 *
 * `bridge-studio-kbs.test.ts` (1,306 lines) was split in M4 to mirror the source
 * split that landed in PR #280 — `bridge-studio-kbs.ts` (2,068) became five
 * modules and the one test file still covered all of them.
 *
 * What lives here is exactly what MORE THAN ONE of the three output files uses:
 * the KB fixture corpus and `setupSharedForge` (all three boot the same shared
 * forge root), `makeIsolatedForge`/`postAt`/`seedProjectBrain` (maintenance and
 * health both need their own root per case). `getAt` is health-only and
 * `post`/`get`/`drainConsolidate` are per-file, so they stayed with their
 * owners — a helper used by one file belongs to it.
 *
 * `setupSharedForge`/`makeIsolatedForge`/`postAt` drive the CARVED HANDLERS
 * directly — no bridge (COMMON §5: a package test never boots one). They hand
 * back a plain forge root, not a URL — there is nothing to close any more.
 * Not exercised here, deliberately: origin/CSRF/404-fallthrough, which are the
 * HOST's policy and live in `cli/*.test.ts`.
 */

import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute } from '@forge/kernel';
import { knowledgeRoutes, type KnowledgeRouteContext } from '../../../routes.ts';

const routes = knowledgeRoutes({
  listFlowIds: () => ['forge-develop'],
  listFlowBandIds: () => ['review-band', 'demo-band'],
});

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured: { status: number | null; body: string } = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

export const CYCLES_KB_YAML = `id: cycles\nname: Cycles Brain\nbinding: { kind: flow, ref: forge-develop }\ndesc: Cross-cycle patterns.\n`;

export const FORGE_DEV_KB_YAML = `id: forge-dev\nname: Forge Dev Brain\nbinding: { kind: unique }\ndesc: Forge engineering decisions.\n`;

// Minimal theme file whose title becomes the theme node id.
// kb-graph derives node ids from the filename slug (without .md extension).
// We write a theme file 'test-theme.md' so the node id will be 'test-theme'.
export const TEST_THEME_MD = `# Test Theme\n\nThis is a test theme node.\n`;

// ---------------------------------------------------------------------------
// R1-06 WI-3 group A fixture: a SCRATCH project KB (never cycles/forge-dev)
// carrying real-corpus-shaped lint-warning findings, for the maintenance
// op:'consolidate' RED pins below. checkFrontmatter / checkIndexSync /
// checkStaleness / checkOrphans (cli/brain-lint.ts) are all hardcoded to
// THEME_SUBDIRS = ['cycles','forge-dev'] and never scan brain/projects/*; the
// ONLY forge-side lint check that covers a project brain at all is
// checkProjectBrainIndexes (cli/brain-lint.ts:337), whose "not listed in
// project category index" finding classifies as resolution:'agent' (line
// 1042-1043) — a real, agent-tier, per-theme finding. Three fixture themes
// with valid frontmatter/category but deliberately absent from patterns.md
// gives 3 independently-clearable findings, so a follow-up lint can prove
// consolidate drained the FULL scoped set, not just one.
// ---------------------------------------------------------------------------
export const CONSOLIDATE_KB_ID = 'r1-06-consolidate';

export const CONSOLIDATE_KB_YAML =
  `id: ${CONSOLIDATE_KB_ID}\nname: R1-06 Consolidate Fixture (scratch)\n` +
  `binding: { kind: project, ref: ${CONSOLIDATE_KB_ID} }\n` +
  `desc: Synthetic scratch project KB seeded ONLY for the WI-3 group A op='consolidate' RED pin — never a real project brain.\n` +
  `backend: filesystem\n`;

export const CONSOLIDATE_PATTERNS_INDEX =
  `# r1-06-consolidate — Patterns\n\n> Category index — deliberately left without theme links (fixture; see cli/bridge-studio-kbs.test.ts).\n\n## Theme pages\n`;

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MAJOR 1 fixture: a SEPARATE, never-consolidated project KB
// (so its finding count stays fixed for the whole file) whose brain lives at
// brain/projects/<id> — the exact shape buildKbHealth's OLD hardcoded
// `resolve(forgeRoot,'brain',<id>)` prefix misses (that path is
// brain/<id>, so the health lint filter yielded 0 and hid the Lint section for
// project KBs). Three unlisted pattern themes ⇒ 3 checkProjectBrainIndexes
// 'flag' findings ⇒ health.lintFlags MUST be 3 once the health filter scopes
// via resolveKbBrainDir like consolidate/lint already do. NEVER mutated.
// ---------------------------------------------------------------------------
export const HEALTH_KB_ID = 'r1-06-health';

export const HEALTH_KB_YAML =
  `id: ${HEALTH_KB_ID}\nname: R1-06 Health Fixture (scratch)\n` +
  `binding: { kind: project, ref: ${HEALTH_KB_ID} }\n` +
  `desc: Synthetic scratch project KB seeded ONLY for the WI-3 review MAJOR 1 health-count pin — never consolidated.\n` +
  `backend: filesystem\n`;

export const HEALTH_PATTERNS_INDEX =
  `# r1-06-health — Patterns\n\n> Category index — deliberately left without theme links (fixture).\n\n## Theme pages\n`;

export function consolidateFixtureTheme(slug: string, n: number): string {
  return (
    '---\n' +
    `title: "R1-06 consolidate fixture theme ${n}"\n` +
    `description: "Synthetic real-corpus-shaped lint-warning fixture (WI-3 group A) — deliberately left out of patterns.md so checkProjectBrainIndexes raises an agent-tier finding."\n` +
    'category: pattern\n' +
    'created_at: "2026-08-01T00:00:00Z"\n' +
    'updated_at: "2026-08-01T00:00:00Z"\n' +
    '---\n\n' +
    `# R1-06 consolidate fixture theme ${n}\n\n` +
    `Synthetic fixture theme (slug \`${slug}\`) for the maintenance op='consolidate' RED pin. Not a real cycle learning — safe to delete.\n`
  );
}

/** The shared forge root the file-level `before()` used to build inline.
 *  Returned rather than assigned to module state so each output file owns
 *  its own instance and its own teardown (an `rmSync`, since there is no
 *  bridge left to close). */
export async function setupSharedForge(): Promise<{ root: string }> {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-kbs-'));

  // Minimal _queue + _logs required by the carved handlers' listRuns path
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // KB: cycles (used for guidance tests)
  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'cycles', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
  // Write a theme node so resolve-node can find it
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes', 'test-theme.md'), TEST_THEME_MD);

  // KB: forge-dev
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'kb.yaml'), FORGE_DEV_KB_YAML);

  // KB: r1-06-consolidate (scratch project brain, WI-3 group A fixture — see
  // the fixture-helpers comment above). NEVER cycles/forge-dev.
  const consolidateDir = join(forgeRoot, 'brain', 'projects', CONSOLIDATE_KB_ID);
  mkdirSync(join(consolidateDir, 'themes'), { recursive: true });
  writeFileSync(join(consolidateDir, 'kb.yaml'), CONSOLIDATE_KB_YAML);
  writeFileSync(join(consolidateDir, 'patterns.md'), CONSOLIDATE_PATTERNS_INDEX);
  for (const [slug, n] of [['theme-a', 1], ['theme-b', 2], ['theme-c', 3]] as const) {
    writeFileSync(join(consolidateDir, 'themes', `${slug}.md`), consolidateFixtureTheme(slug, n));
  }

  // KB: r1-06-health (scratch project brain, MAJOR 1 fixture — never
  // consolidated, so its 3 checkProjectBrainIndexes flags stay fixed).
  const healthDir = join(forgeRoot, 'brain', 'projects', HEALTH_KB_ID);
  mkdirSync(join(healthDir, 'themes'), { recursive: true });
  writeFileSync(join(healthDir, 'kb.yaml'), HEALTH_KB_YAML);
  writeFileSync(join(healthDir, 'patterns.md'), HEALTH_PATTERNS_INDEX);
  for (const [slug, n] of [['h-one', 1], ['h-two', 2], ['h-three', 3]] as const) {
    writeFileSync(join(healthDir, 'themes', `${slug}.md`), consolidateFixtureTheme(slug, n));
  }

  return { root: forgeRoot };
}

// ---------------------------------------------------------------------------
// R1-06 WI-3 review pins (MAJOR 2 write-isolation, MINOR 1 poll-hang) need an
// ISOLATED forge-root each: MAJOR 2 mutates on-disk brains, and MINOR 1's
// directory-as-index makes runBrainLint(scope:'full') throw for the WHOLE
// root — either would corrupt the shared fixture's other tests. Minimal
// _queue/_logs scaffold mirrors the shared `before()`.
// ---------------------------------------------------------------------------
export async function makeIsolatedForge(): Promise<{ root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'kbs-review-pin-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root };
}

/** Drives one carved route handler directly against `root` and hands back the
 *  same `{status, json}` shape the old `fetch`-based `postAt` returned — T1
 *  ruling 30: the host parses the body and hands the RESULT down, so this
 *  supplies the result rather than faking a request stream. */
export async function postAt(
  root: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: KnowledgeRouteContext = {
    forgeRoot: root,
    logsRoot: join(root, '_logs'),
    readBody: async () => body ?? {},
  };
  const matched = await dispatchRoute(routes, mockReq(), res, ctx, path, 'POST');
  if (!matched) return { status: 404, json: {} };
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

/** A synthetic project brain: kb.yaml (project binding) + a category index + N
 *  unlisted `pattern` themes ⇒ N checkProjectBrainIndexes 'not listed' findings.
 *  `patternsAsDir:true` makes patterns.md a DIRECTORY (MINOR 1 throw injection —
 *  readIndexEntries' readFileSync throws EISDIR on a dir). */
export function seedProjectBrain(
  root: string,
  id: string,
  themeSlugs: readonly string[],
  opts?: { patternsAsDir?: boolean },
): void {
  const dir = join(root, 'brain', 'projects', id);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(
    join(dir, 'kb.yaml'),
    `id: ${id}\nname: ${id}\nbinding: { kind: project, ref: ${id} }\ndesc: isolated review-pin fixture.\nbackend: filesystem\n`,
  );
  if (opts?.patternsAsDir) mkdirSync(join(dir, 'patterns.md'), { recursive: true });
  else writeFileSync(join(dir, 'patterns.md'), `# ${id} — Patterns\n\n> fixture index.\n\n## Theme pages\n`);
  themeSlugs.forEach((slug, i) => {
    writeFileSync(join(dir, 'themes', `${slug}.md`), consolidateFixtureTheme(slug, i + 1));
  });
}
