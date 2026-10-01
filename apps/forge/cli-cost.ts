/**
 * `forge cost by-class` — §7.3 release-definition evidence: cost-per-merged-
 * initiative by ADR 051 change class. A verb shell over the pure producer
 * `packages/flows/cost-by-class.ts`'s `costByClass` — argv/`--root` in,
 * a table (or `--json`) out. Split out of `cli.ts` (own file, one dispatch
 * line there) so the already-at-cap file does not grow — mirrors
 * `cli-gate.ts`'s split.
 *
 * Usage:
 *   forge cost by-class [--root <forgeRoot>] [--json]
 *
 * Exit 0 always (a reporting verb — an empty forge root is zero rows, not a
 * usage error); exit 2 for an unknown subcommand/flag, matching `cli-gate.ts`'s
 * fail-loud-on-mis-invocation convention.
 */
import { costByClass, type CostByClassRow } from '@forge/flows';
import { flagValueStrict } from './cli-flags.ts';

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function renderTable(rows: readonly CostByClassRow[]): string {
  if (rows.length === 0) return 'forge cost by-class: no merged initiatives found under _queue/done/';
  const header = ['class', 'merged', 'total', 'mean', 'unpriced'];
  const lines = rows.map((r) => [r.class, String(r.merged), formatUsd(r.totalUsd), formatUsd(r.meanUsd), String(r.unpriced)]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const padRow = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [padRow(header), padRow(widths.map((w) => '-'.repeat(w))), ...lines.map(padRow)].join('\n');
}

export function cmdCost(rest: string[], defaultForgeRoot: string): void {
  const sub = rest[0];
  if (sub !== 'by-class') {
    console.error('forge cost: subcommands: by-class');
    console.error('  forge cost by-class [--root <forgeRoot>] [--json]');
    process.exitCode = 2;
    return;
  }

  const body = rest.slice(1);
  for (const a of body) {
    if (a === '--json' || a === '--root') continue;
    if (a.startsWith('--')) {
      console.error(`forge cost by-class: unknown flag: ${a}`);
      process.exitCode = 2;
      return;
    }
  }

  const root = flagValueStrict(body, 'root') ?? defaultForgeRoot;
  const asJson = body.includes('--json');
  const rows = costByClass(root);

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(renderTable(rows));
  }
  process.exitCode = 0;
}
