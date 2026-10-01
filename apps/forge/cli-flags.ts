/**
 * `--<name> value` flag lookups shared by the `forge` CLI verbs (cli.ts and
 * cli-create.ts). A plain module of its own so a verb split out of cli.ts can
 * use them without importing cli.ts, whose top level dispatches argv.
 */
// `--<name> value` lookup shared by the cmd*/runCreate flag parsers (6.11.33 dedupe).
export function flagValue(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
// As `flagValue`, but never returns the NEXT flag's name as this flag's value.
export function flagValueStrict(rest: string[], name: string): string | undefined {
  const v = flagValue(rest, name);
  return v !== undefined && !v.startsWith('--') ? v : undefined;
}
