import { basename } from 'node:path';

import type { AcceptanceGateConfig } from '@forge/projects';

/**
 * The live-acceptance env guard's one decision (D-34,
 * bead forge-mfv5.3.5). When this WI's gate targets the project's
 * live-acceptance suite (its `match`), the gate must run with the tier's
 * `requiresEnv` set — else the runner SKIPS and the gate false-passes (the
 * daemon ran betterado cycles without TF_ACC and shipped unverified
 * resources). The returned names are handed to the gate, which ERRORS when one
 * is unset. The guard deliberately takes NO change class: the class's
 * `acceptance` column decides only whether the project manager must plan a
 * live-acceptance work item, and a live gate that runs is guarded whatever the
 * class says, so a mis-declared `docs` class cannot turn the guard off.
 * `undefined` = no demand.
 */
export function liveAcceptanceEnvFor(
  accGate: AcceptanceGateConfig | undefined,
  gateCmd: readonly string[],
): string[] | undefined {
  if (!accGate?.requires_env || accGate.requires_env.length === 0) return undefined;
  return gateCmd.some((tok) => tok.includes(accGate.match)) ? accGate.requires_env : undefined;
}

/**
 * A non-shell interpreter (a shell's `-c` operand is a command line and stays readable), per interpreter: `flag` is its
 * inline-program flag (clustered only with flags that take no value, so `ruby -rtime` is not `-e`), `joined` one carrying its
 * program in the same token, `valued` an option whose value is the next token, `stop` the module form (`python3 -m`).
 */
type Interpreter = { name: RegExp; flag: RegExp; joined?: RegExp; valued?: RegExp; stop?: RegExp };
const INLINE: readonly Interpreter[] = [
  { name: /^(?:python|pypy)[\d.]*$/, flag: /^-[bBdEhiIOPqRsSuvVx]*c$/, joined: /^-[bBdEhiIOPqRsSuvVx]*c./, valued: /^(?:-[WX]|--check-hash-based-pycs)$/, stop: /^-[bBdEhiIOPqRsSuvVx]*m/ },
  { name: /^(?:node|nodejs)$/, flag: /^(?:-[ep]|-pe|--eval|--print)$/, joined: /^--(?:eval|print)=/, valued: /^(?:-[rC]|--(?:require|import|loader|experimental-loader|conditions|input-type))$/ },
  { name: /^ruby[\d.]*$/, flag: /^-(?:0[0-7]*)?[acdlnpsSvwWy]*e$/, valued: /^-[ICEr]$/ },
  { name: /^perl[\d.]*$/, flag: /^-(?:0[0-9a-fA-Fx]*)?[aclnpstTuUvwWX]*[eE]$/ },
  { name: /^php[\d.]*$/, flag: /^-r$/, valued: /^-[cdz]$/ },
];

/** Whether `argv[index]` ends the interpreter's options: its program flag (`'inline'`), its program file or module (`'program'`). */
function optionEnd(i: Interpreter, argv: readonly string[], index: number): 'inline' | 'program' | undefined {
  const t = argv[index]!;
  if (i.flag.test(t) || i.joined?.test(t)) return 'inline';
  if (t === '-' || t === '--' || !t.startsWith('-') || i.stop?.test(t)) return 'program';
  return undefined;
}

/** A check's acceptance class: the tier's env, and the argv token that classed it (named when the gate refuses — forge-mfv5.1.59). */
export type LiveAcceptanceClass = { requiresEnv: string[]; index: number; token: string };

/**
 * The same decision for a per-AC check (D-20, forge-mfv5.1.44/.59): when the check runs an interpreter with an inline program
 * (`python3 -c`, `node -e`/`--eval`), everything from the program operand to the end of argv is the program and its own argv —
 * code, not the suite the command targets — so none of it is matched; flags before the program and a script file's arguments
 * still are. gitweave I3b WI-15 named `tests/acceptance` inside its `python3 -c` program; I4 WI-18's exec-split probes
 * (`python3 -c "exec(''.join(sys.argv[1:]))" chunk…`) carried `--ignore=tests/acceptance` in a chunk. Both were classed as the
 * live suite and their exit 0 refused for carrying no runner summary.
 */
export function liveAcceptanceClassOf(accGate: AcceptanceGateConfig | undefined, argv: readonly string[]): LiveAcceptanceClass | undefined {
  if (!accGate?.requires_env || accGate.requires_env.length === 0) return undefined;
  let options = INLINE.find((i) => i.name.test(basename(argv[0] ?? '')));
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    const end = options && index > 0 && !options.valued?.test(argv[index - 1]!) ? optionEnd(options, argv, index) : undefined;
    if (end === 'inline') return undefined;
    if (end === 'program') options = undefined;
    if (token.includes(accGate.match)) return { requiresEnv: accGate.requires_env, index, token };
  }
  return undefined;
}

/** The check's inherited `requiresEnv` AND its acceptance class (`undefined` = neither). */
export function liveAcceptanceEnvForCheck(accGate: AcceptanceGateConfig | undefined, argv: readonly string[]): string[] | undefined {
  return liveAcceptanceClassOf(accGate, argv)?.requiresEnv;
}
