/**
 * W8-B5 WI-3 — `forge community refresh` (exit row E1).
 *
 * A THIN wrapper: it parses argv, calls the ONE shared runner
 * (packages/library/community-refresh-run.ts), prints, and RETURNS a number that
 * orchestrator/cli.ts hands to `process.exit`. It makes no decision of its
 * own about what a refresh means — that lives in the runner, so the bridge
 * route reaches the identical behaviour. Shape copied from
 * `cmdProjectMigrate` (packages/projects/project-migrate.ts), which is this repo's
 * exemplar for a two-level `forge <noun> <verb>` handler.
 *
 * EXIT CODES, and why each one:
 *   0  the pass completed and every source that could be verified was
 *   1  a refusal, OR a completed pass in which at least one source FAILED.
 *      A partial failure is a failure: the registry now holds verified rows
 *      beside untouched stale ones, and an operator who sees exit 0 will
 *      believe the whole file was checked.
 *   2  usage — an unknown/missing sub-verb or an unknown flag. Never guessed
 *      at, because a mistyped flag silently ignored is a run that did
 *      something other than what was asked.
 *
 * THE CREDENTIAL IS NEVER PRINTED. Not the value, not a prefix, not a length.
 * The only three things this command will ever say about it are: it is absent,
 * GitHub rejected it, or nothing at all.
 */

import { communityRefreshRemedy, runCommunityRefresh, type CommunityRefreshRunResult } from './community-refresh-run.ts';
import type { CommunityRefreshOutcome } from './studio/community-refresh-api.ts';

const USAGE = [
  'usage: forge community refresh [--dry-run]',
  '',
  '  Verify every community-registry row against its upstream API (GitHub, npm,',
  '  the MCP registry) and write the verified facts back to',
  '  studio/community/registry.yaml. Deterministic: no agent, no LLM.',
  '',
  '  --dry-run   compute and print the full report, write nothing.',
  '',
  '  Requires GH_TOKEN (a GitHub token with public-repository read access).',
].join('\n');

/** One line per registry row, in registry order. `unchanged` is reported as
 *  loudly as `refreshed`: both mean VERIFIED, and an operator reading a
 *  screen of "unchanged" is reading a screen of successful checks, not of
 *  skipped ones. */
function formatOutcome(o: CommunityRefreshOutcome): string {
  const mark = o.status === 'refreshed' ? '+' : o.status === 'unchanged' ? '=' : o.status === 'no-upstream' ? '·' : '✗';
  return `  ${mark} ${o.id} → ${o.status}: ${o.detail}`;
}

function printReport(result: Extract<CommunityRefreshRunResult, { ok: true }>): void {
  console.log(`forge community refresh: ${result.path}`);
  for (const o of result.outcomes) console.log(formatOutcome(o));

  const c = result.counts;
  console.log(
    `\n  refreshed ${c.refreshed} · unchanged ${c.unchanged} · no-upstream ${c.noUpstream} · failed ${c.failed} (of ${c.total} rows)`,
  );

  if (result.errors.length > 0) {
    console.error('\nsources that did NOT verify (their rows were left untouched):');
    for (const e of result.errors) console.error(`  ✗ ${e.source} [${e.kind}] ${e.message}`);
  }

  if (result.dryRun) {
    console.log('\n  dry run — nothing was written.');
  } else if (result.wrote) {
    console.log(`\n  wrote ${result.path} (meta.lastRefresh = ${result.lastRefresh}).`);
  } else {
    console.log('\n  nothing verified — the registry was left byte-identical.');
  }
}

/** `forge community <verb>` — the noun's dispatcher. Returns the process exit
 *  code; orchestrator/cli.ts owns the actual `process.exit`. */
export async function cmdCommunity(args: string[], forgeRoot: string): Promise<number> {
  const verb = args[0];
  if (verb !== 'refresh') {
    console.error(verb === undefined ? USAGE : `forge community: unknown subcommand "${verb}"\n\n${USAGE}`);
    return 2;
  }

  let dryRun = false;
  for (const arg of args.slice(1)) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    console.error(`forge community refresh: unknown option "${arg}"\n\n${USAGE}`);
    return 2;
  }

  const result = await runCommunityRefresh({ forgeRoot, dryRun });

  if (!result.ok) {
    console.error(`forge community refresh: ${result.message}`);
    console.error(`\n  ${communityRefreshRemedy(result.reason)}`);
    return 1;
  }

  printReport(result);
  // A completed pass with a failed source is NOT a success.
  return result.errors.length > 0 ? 1 : 0;
}
