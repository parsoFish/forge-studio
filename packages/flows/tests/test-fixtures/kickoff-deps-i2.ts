/**
 * Bead forge-mfv5.1.36 — gitweave I2 at the Kickoff gate, as it stood live on
 * 2026-10-11 (forge a2c521f84) after the operator's first two D-48 adds.
 *
 * PROVENANCE. `kickoff-deps-i2/manifest.md.fixture` is the live
 * `_queue/ready-for-review/INIT-2026-10-11-i2-apply-engine-terraform-retired.md`
 * — frontmatter verbatim except `project_repo_path` / `worktree_path`
 * (placeholders, re-pointed into the tmp root), body trimmed.
 * `kickoff-deps-i2/WI-13.md.fixture` and `WI-14.md.fixture` are the two
 * kickoff-added work items, verbatim (`depends_on: []` — the defect). The 15
 * plan work items are byte-identical to `pm-repair-i2-stranded/work-items/`
 * (`cmp` against the live worktree), so they are read from there, not copied.
 *
 * Bead forge-nk1y.32 — `WI-13.now.md.fixture` / `WI-14.now.md.fixture` are the
 * same two work items as they stood live later on 2026-10-11 (forge 84b11e29),
 * verbatim, after row 11's dependency edits: WI-14 still holds ONE
 * files_in_scope entry naming two paths ("tests/test_docs_no_terraform_tokens.py
 * .github/copilot-context.md") and no `creates` — the defect. `events.jsonl.fixture`
 * is the cycle log's four `kickoff.work-item-*` lines, verbatim except the
 * forge root in `input_refs` (placeholder `FORGE_ROOT`): the provenance that
 * marks WI-13/14 as added at the gate. `plantI2Kickoff(root, { live: true })`.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const I2_INIT = 'INIT-2026-10-11-i2-apply-engine-terraform-retired';
export const I2_CYCLE = '2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired';
/** The plan's leaf work items: no other plan WI depends on them. */
export const I2_PLAN_LEAVES = ['WI-9b', 'WI-10', 'WI-11', 'WI-12'];

const HERE = join(import.meta.dirname);
const PLAN_DIR = join(HERE, 'pm-repair-i2-stranded', 'work-items');
const KICKOFF_DIR = join(HERE, 'kickoff-deps-i2');

/** Every I2 work-item fixture file → its work-item file name (`WI-3a.md`). */
export function i2WorkItemFiles(opts: I2PlantOpts): Array<{ name: string; path: string }> {
  const plan = readdirSync(PLAN_DIR).map((f) => ({ name: f.replace(/\.fixture$/, ''), path: join(PLAN_DIR, f) }));
  const adds = ['WI-13', 'WI-14'].map((id) => ({ name: `${id}.md`, path: join(KICKOFF_DIR, `${id}${opts.live ? '.now' : ''}.md.fixture`) }));
  return opts.withKickoffAdds ? [...plan, ...adds] : plan;
}

/** `live`: WI-13/14 as they are now (row 11's edits) plus the kickoff events (forge-nk1y.32). */
export type I2PlantOpts = { withKickoffAdds: boolean; live?: boolean };
export type I2Paths = { manifestPath: string; wiDir: string; snapshotDir: string; logDir: string };

/**
 * Plant I2 at the Kickoff gate under `forgeRoot`: the manifest in
 * `ready-for-review`, the set in the initiative worktree AND the cycle's
 * snapshot (the kickoff add writes both). `withKickoffAdds: false` plants the
 * 15 plan WIs only (the manifest's `specs` still lists WI-13/14; nothing reads
 * specs for the gate).
 */
export function plantI2Kickoff(forgeRoot: string, opts: I2PlantOpts = { withKickoffAdds: true }): I2Paths {
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  const repo = join(forgeRoot, 'projects', 'gitweave');
  const worktree = join(forgeRoot, '_worktrees', I2_INIT);
  const wiDir = join(worktree, '.forge', 'work-items');
  const logDir = join(forgeRoot, '_logs', I2_CYCLE);
  const snapshotDir = join(logDir, 'work-items-snapshot');
  for (const d of [repo, wiDir, snapshotDir]) mkdirSync(d, { recursive: true });
  const manifestPath = join(forgeRoot, '_queue', 'ready-for-review', `${I2_INIT}.md`);
  writeFileSync(manifestPath, readFileSync(join(KICKOFF_DIR, 'manifest.md.fixture'), 'utf8')
    .replace('PROJECT_REPO_PATH', repo).replace('WORKTREE_PATH', worktree));
  for (const f of i2WorkItemFiles(opts)) {
    copyFileSync(f.path, join(wiDir, f.name));
    copyFileSync(f.path, join(snapshotDir, f.name));
  }
  if (opts.live) writeFileSync(join(logDir, 'events.jsonl'), readFileSync(join(KICKOFF_DIR, 'events.jsonl.fixture'), 'utf8').replaceAll('FORGE_ROOT', forgeRoot));
  return { manifestPath, wiDir, snapshotDir, logDir };
}
