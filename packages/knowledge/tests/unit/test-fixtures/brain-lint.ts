/**
 * Shared fixtures for the brain-lint unit suite.
 *
 * `brain-lint.test.ts` (1,463 lines) was split in M4 to mirror the source split
 * that had already happened underneath it — `brain-lint.ts` became a
 * registry/orchestration module over `brain-lint-checks-{filing,integrity,graph}.ts`,
 * and the one test file still covered all three plus the registry.
 *
 * These six live here because they are used by MORE THAN ONE of the four output
 * files, which is the whole rule: `buildBrainFixture` + `cleanup` (and the two
 * spec types they take) build the corpus for all four; `cf` mints a bare Finding
 * for the classification assertions in BOTH the orchestration file and
 * `checkReflectorLoss`'s own tier case; `writeProjectTheme` is used by the three
 * `checkProjectBrainIndexes` cases in the filing file AND by the CHECK_NAMES
 * drift guard in the orchestration file.
 *
 * `writeProjectIndex` (filing only) and `buildQueueFixture` (integrity only)
 * deliberately did NOT come here — a fixture used by one file belongs to it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Finding } from '../../../brain-lint.ts';

export type ThemeSpec = {
  /** Relative path under brain/ (e.g. `cycles/themes/foo.md`). */
  path: string;
  /** Frontmatter as a partial object — title/description/category/created_at/updated_at default to valid values when omitted. */
  fm?: Partial<{
    title: string;
    description: string;
    category: string;
    created_at: string;
    updated_at: string;
    recurrence: string;
    keywords: string[];
    related_themes: string[];
  }>;
  /** Body markdown after frontmatter. */
  body?: string;
};

export type BrainFixtureSpec = {
  themes: ThemeSpec[];
  /** Extra files at arbitrary paths (e.g. `INDEX.md`, `forge/patterns.md`, `projects/<n>/profile.md`). */
  extra?: Array<{ path: string; content: string }>;
};

export function buildBrainFixture(spec: BrainFixtureSpec): string {
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-test-'));
  const brain = join(root, 'brain');
  mkdirSync(brain, { recursive: true });

  // INDEX.md must always exist for orphan/index-sync checks.
  if (!spec.extra?.some((e) => e.path === 'INDEX.md')) {
    writeFileSync(join(brain, 'INDEX.md'), '# Brain\n\nnavigation hub.\n');
  }

  // Cycle-level category indexes — default to empty stubs so checkIndexSync has a target.
  for (const cat of ['patterns', 'antipatterns', 'decisions', 'operations']) {
    const p = join(brain, 'cycles', `${cat}.md`);
    mkdirSync(join(brain, 'cycles'), { recursive: true });
    if (!spec.extra?.some((e) => e.path === `cycles/${cat}.md`)) {
      writeFileSync(p, `# ${cat}\n`);
    }
  }
  // forge-dev/ category indexes
  for (const cat of ['decisions', 'reference']) {
    const p = join(brain, 'forge-dev', `${cat}.md`);
    mkdirSync(join(brain, 'forge-dev'), { recursive: true });
    if (!spec.extra?.some((e) => e.path === `forge-dev/${cat}.md`)) {
      writeFileSync(p, `# ${cat}\n`);
    }
  }
  mkdirSync(join(brain, 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(brain, 'projects'), { recursive: true });

  for (const t of spec.themes) {
    const file = join(brain, t.path);
    mkdirSync(join(file, '..'), { recursive: true });
    const fm = {
      title: t.fm?.title ?? `theme-${t.path}`,
      description: t.fm?.description ?? 'description text.',
      category: t.fm?.category ?? 'pattern',
      created_at: t.fm?.created_at ?? '2026-01-01T00:00:00Z',
      updated_at: t.fm?.updated_at ?? '2026-01-01T00:00:00Z',
      keywords: t.fm?.keywords ?? [],
      related_themes: t.fm?.related_themes ?? [],
      ...(t.fm?.recurrence ? { recurrence: t.fm.recurrence } : {}),
    };
    const lines = ['---'];
    for (const [k, v] of Object.entries(fm)) {
      if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
      else lines.push(`${k}: ${v}`);
    }
    lines.push('---');
    lines.push('');
    lines.push(t.body ?? '# theme body');
    writeFileSync(file, lines.join('\n') + '\n');
  }

  for (const e of spec.extra ?? []) {
    const file = join(brain, e.path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, e.content);
  }

  return root;
}

export function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export const cf = (check: string, message: string): Finding => ({ category: 'error', file: '/x.md', message, check });

export function writeProjectTheme(root: string, project: string, slug: string, category: string): void {
  const themes = join(root, 'brain', 'projects', project, 'themes');
  mkdirSync(themes, { recursive: true });
  writeFileSync(
    join(themes, `${slug}.md`),
    `---\ntitle: ${slug}\ndescription: d\ncategory: ${category}\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\nbody\n`,
  );
}
