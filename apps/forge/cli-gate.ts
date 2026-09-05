/**
 * `forge gate docs` — the docs class's merge-boundary gate as an ORCHESTRATOR
 * VERB (spec §5 item 6, ADR 036).
 *
 * The rules live in `@forge/factory/gates/docs-gate.ts`; this file is the shell
 * that turns argv into a spec and findings into an exit code. The split is the
 * point: the gate's verdict is computed by code the orchestrator owns and runs,
 * never by a command string an agent authored — the docs profile's
 * `mergeBoundaryTest` is empty precisely because prose has no suite, and if the
 * gate were agent-authored the agent writing the docs would be writing the test
 * that judges them.
 *
 * Usage:
 *   forge gate docs [--sections A,B] [--forbid x,y] [--no-links] <path...>
 *
 * Exit 0 = no findings. Exit 1 = findings, each printed `path:line [check] detail`.
 * Exit 2 = usage error, so a mis-typed gate invocation FAILS LOUD instead of
 * passing on an empty file list (a gate that greens on "nothing to check" is the
 * failure this milestone keeps finding).
 */

import { runDocsGate, type DocsGateSpec } from '@forge/factory/gates/docs-gate.ts';

export function cmdGate(rest: string[]): void {
  const sub = rest[0];
  if (sub !== 'docs') {
    console.error('forge gate: subcommands: docs');
    console.error('  forge gate docs [--sections A,B] [--forbid x,y] [--no-links] <path...>');
    process.exitCode = 2;
    return;
  }

  const spec: DocsGateSpec = {};
  const paths: string[] = [];
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--sections') spec.sections = splitList(rest[++i]);
    else if (a === '--forbid') spec.forbidden = splitList(rest[++i]);
    else if (a === '--no-links') spec.links = false;
    else if (a !== undefined && a.startsWith('-')) {
      console.error(`forge gate docs: unknown flag: ${a}`);
      process.exitCode = 2;
      return;
    } else if (a !== undefined) paths.push(a);
  }

  if (paths.length === 0) {
    console.error('forge gate docs: at least one path is required');
    process.exitCode = 2;
    return;
  }

  const findings = runDocsGate(paths, spec);
  for (const f of findings) console.error(`${f.path}:${f.line} [${f.check}] ${f.detail}`);
  console.log(
    findings.length === 0
      ? `forge gate docs: PASS — ${paths.length} document(s), 0 findings`
      : `forge gate docs: FAIL — ${findings.length} finding(s) across ${paths.length} document(s)`,
  );
  process.exitCode = findings.length === 0 ? 0 : 1;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}
