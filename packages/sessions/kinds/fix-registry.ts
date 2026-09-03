/**
 * The SESSION-LESS fix-turn dispatch — the surface `apps/forge/cli.ts`'s
 * `brain fix` and `preflight fix` subcommands resolve their kind through
 * (exit row 3, rulings 60/62).
 *
 * A SECOND table rather than rows in `SESSION_KIND_RUNNERS`, and separate
 * files rather than one; `../design.md` gives both reasons. In short: that
 * table answers `forge agent run <agent-id> <session-id>` and its keys feed
 * that command's usage line, which these two ids do not belong on (§15.79);
 * and it statically imports all four session kinds, so resolving through it
 * would load ~2,400 lines of architect to repair one theme.
 *
 * §15.77 (`AT-7`): anything enumerating "every session-kind runner" must read
 * `SESSION_KIND_RUNNERS` AND this table. Unlike that one, this table feeds no
 * derived operator-facing list, so it carries no ordering contract.
 *
 * `loadRunTurn` keeps its DYNAMIC import for the same isolation reason. The
 * rows carry no shared `Record<...>` annotation on purpose: TypeScript then
 * infers each row's precise types from the module it imports, so the CLI keeps
 * `RunBrainFixResult` / `ClauseId` at the call site instead of casting
 * `unknown` back into shape — a cast that lies is how a carve reads
 * `undefined` at runtime with nothing red (§15.66).
 *//**
 * What a subcommand needs to know about one session-less fix kind. Every row
 * must satisfy this; the test asserts it rather than the declaration, so the
 * precise per-kind types survive (see the header).
 */
export interface FixKindRunner {
  /** The subcommand verb, for error and usage text. */
  verb: string;
  /** Resolve the kind's turn function, loading only that kind's module. */
  loadRunTurn: () => Promise<(input: never) => Promise<unknown>>;
  /** Print the kind's own console summary for one finished turn. */
  printResult: (runId: string, result: never) => void;
}

export const FIX_KIND_RUNNERS = {
  'brain-fix': {
    verb: 'brain fix',
    loadRunTurn: async () => (await import('./brain-fix.ts')).runBrainFixTurn,
    printResult: (
      runId: string,
      result: Awaited<ReturnType<(typeof import('./brain-fix.ts'))['runBrainFixTurn']>>,
      context: { kind: string; file: string },
    ) => {
      console.log(
        `brain-fix [${runId}]: ${result.cleared ? 'CLEARED' : 'NOT cleared'} — ${context.kind} ${context.file}`,
      );
      // W8-F1 — say WHY, not just that it did not clear. This command reads
      // `cleared` and used to print nothing else, so an edit the gate refused
      // (or a disposal it could not carry out) was invisible on the one path
      // an operator drives by hand. `editAudit` is populated on every turn
      // now; a field produced and read by nobody is the shape this lane exists
      // to close. Moved here with the port so the kind that produces the audit
      // is the kind that reports it.
      for (const u of result.editAudit.unsound) console.log(`  ${u.relPath}: ${u.message}`);
      for (const e of result.editAudit.errors) console.error(`  ${e}`);
    },
  },
  'preflight-fix': {
    verb: 'preflight fix',
    loadRunTurn: async () => (await import('./preflight-fix.ts')).runPreflightFixTurn,
    printResult: (
      runId: string,
      result: Awaited<ReturnType<(typeof import('./preflight-fix.ts'))['runPreflightFixTurn']>>,
      context: { clause: string },
    ) => {
      console.log(
        `preflight-fix [${runId}]: ${result.cleared ? 'CLEARED' : 'NOT cleared'} — ${context.clause}`,
      );
    },
  },
};

/** The ids this table dispatches — the union half `AT-7` must also read. */
export type FixKindId = keyof typeof FIX_KIND_RUNNERS;
