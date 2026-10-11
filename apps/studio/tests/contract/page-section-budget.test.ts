/**
 * D-46 / dev/UI-CONSTRAINTS.md §3 — "a page carries at most five top-level
 * sections". A top-level section is an element carrying
 * `data-page-section="<name>"`: a titled group that wraps the route's
 * existing `data-section` blocks (it never replaces them — the stories read
 * those). One row per route that has been brought inside its budget
 * (forge-nk1y.37, R56); each row names the groups in order.
 *
 * KILLS: a route that stacks its blocks loose again (no groups → count 0
 * ≠ the declared list), a sixth group added past the cap, or a group renamed
 * without this table (and the plan's shape paragraph) moving with it.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUDIO = join(__dirname, '..', '..');

/** Each group names the blocks it must wrap (a JSX tag or a data-section
 *  literal), so a group left empty or a block left loose beside it reds. */
type Row = { route: string; file: string; max: number; groups: string[]; wraps: Record<string, string[]> };

const ROWS: Row[] = [
  {
    route: '/projects/[id] (editor tab)',
    file: 'app/projects/[id]/page.tsx',
    max: 5,
    groups: ['brief', 'demo', 'skills-knowledge', 'cycle-ledger', 'contract'],
    wraps: {
      brief: ['<NorthStar', '<Instructions'],
      demo: ['<DemoTimeline'],
      'skills-knowledge': ['<SkillsBind', '<KbBind'],
      'cycle-ledger': ['<ProjectCycleLedger'],
      contract: ['<ContractReadiness', '<RebuildContractPanel', '<ContractPanelMount', '<OnboardWithAgent', '<OpenSessionsPanel'],
    },
  },
  {
    route: '/flows/[id]/run/[runId]',
    file: 'components/studio/FlowRunDetail.tsx',
    max: 5,
    groups: ['status', 'timeline', 'findings'],
    wraps: {
      status: ['data-section="run-breadcrumb"', '<RunTrigger', '<GateLink', '<RunControls'],
      timeline: ['<RunTimeline'],
      findings: ['<ReviewFindingsPanel'],
    },
  },
  {
    // The catalog palette is the left tool rail (layout chrome, like the nav)
    // and the save bar is the page's action bar — neither is a section.
    route: '/agents/[id]',
    file: 'app/agents/[id]/page.tsx',
    max: 5,
    groups: ['identity', 'materials', 'runtime', 'evidence', 'history'],
    wraps: {
      identity: ['<StarterPicker', 'data-field="agent-name"'],
      materials: ['data-field="purpose"', '<InstructionsField', 'data-field="interactivity"', '<MaterialsPicker'],
      runtime: ['data-section="advanced"', '<RuntimePicker', '<ReadOnlyFields'],
      evidence: ['<RunPanel', '<YamlPreview', '<ReadinessPanel', '<UsedInFlows'],
      history: ['<HistoryLedger'],
    },
  },
  {
    route: '/monitor',
    file: 'app/monitor/page.tsx',
    max: 3,
    groups: ['summary', 'rail', 'ledger'],
    wraps: {
      summary: ['<MonitorSummaryStrip', 'data-section="serve-status"', 'data-section="monitor-attention"', '<HomeSessionsStrip'],
      rail: ['<RunRail'],
      ledger: ['<UnresolvedHistoriesNotice', '<HistoryLedger'],
    },
  },
];

function pageSections(file: string): string[] {
  const src = readFileSync(join(STUDIO, file), 'utf8');
  return [...src.matchAll(/data-page-section="([a-z-]+)"/g)].map((m) => m[1]);
}

for (const row of ROWS) {
  test(`${row.route}: at most ${row.max} top-level sections, declared in order`, () => {
    const found = pageSections(row.file);
    expect(found.length).toBeLessThanOrEqual(row.max);
    expect(found).toEqual(row.groups);
  });

  test(`${row.route}: each group wraps its own blocks`, () => {
    const src = readFileSync(join(STUDIO, row.file), 'utf8');
    const starts = row.groups.map((g) => src.indexOf(`data-page-section="${g}"`));
    row.groups.forEach((g, i) => {
      const body = src.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
      for (const block of row.wraps[g] ?? []) {
        // a mount is the tag followed by whitespace — never a `<Tag>` in a comment
        const mount = new RegExp(`${block}\\s`, 'g');
        expect(body.match(mount)?.length ?? 0, `${g} wraps ${block}`).toBe(1);
        expect(src.match(mount)?.length ?? 0, `${block} mounted once`).toBe(1);
      }
    });
  });
}
