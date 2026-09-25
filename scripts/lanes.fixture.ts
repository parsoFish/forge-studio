/**
 * lanes.test.ts's fixture-binary builders — split out so `lanes.test.ts` (796/800 lines
 * before this move) has room to fix a real race rather than raise the cap. Pure functions:
 * every path this needs (`dir`, `rosterFile`) is a parameter, never a module-level closure,
 * so lanes.test.ts's `before()`-assigned `let`s stay exactly where they are.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeExec(dir: string, name: string, body: string) {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

/**
 * A binary at `<dir>/<name>/<name>`, so its `comm` (what `pgrep -x` matches) is <name>.
 * A copy of `sleep`: it idles, and it is not the real program of that name.
 */
export function fakeBin(dir: string, name: string) {
  const d = join(dir, `bin-${name}`);
  mkdirSync(d, { recursive: true });
  const p = join(d, name);
  // Copied once per name: re-copying over a running copy is ETXTBSY, and every planted
  // process of that name wants the same binary anyway.
  if (!existsSync(p)) {
    copyFileSync(execFileSync('bash', ['-c', 'command -v sleep'], { encoding: 'utf8' }).trim(), p);
    chmodSync(p, 0o755);
  }
  return p;
}

/**
 * A lane program: registers itself in the roster (what a real claude session does by
 * existing), records its argv/env, then idles.
 *
 * `register` values are the ones `claude agents --json` really emits, measured on
 * Claude Code v2.1.260 (2026-09-04, bead forge-8vfn.2.31):
 *   busy     — working
 *   waiting  — parked on a dialog: `{"status":"waiting","waitingFor":"permission prompt"}`.
 *              `waitingFor` is only present while waiting; there is NO `state` key, and no
 *              observed value anywhere contains the string "blocked".
 *   never    — the trust dialog: the session never reaches the roster at all, while its
 *              process is alive in the lane's cwd.
 *
 * Register row "lanes.test.ts:761": the registration used to fork `python3` to
 * read-modify-write the roster JSON, and it ran AFTER argv/env were captured — two forks
 * and a full interpreter start-up standing between "the shim exists" and "the row exists".
 * Under real contention (host load 18-20) that start-up alone outran the confirm loop's
 * whole window, twice, and widening the window is not a fix for an unbounded race: no fixed
 * number out-runs "the scheduler hasn't given python3 a timeslice yet". `register_row` below
 * is the FIRST thing this process does and never forks — it is bash's own string
 * arithmetic against a roster it already knows always looks like `[]` or `[{...}]` (that
 * shape is a fixture invariant: only `setRoster()` and this function ever write it), so the
 * row exists the moment this shell itself gets scheduled to run at all — which is exactly
 * the one thing CONFIRM_TIMEOUT_S is sized to wait out.
 *
 * Register row "lanes.test.ts:446" — TWO races were found under this same name; both are
 * fixed, in different places:
 *   1. Registering FIRST cuts the opposite way for argv/env — `launch` can confirm (roster
 *      row visible) before THIS shell has reached the `printf`/`printenv` lines below it,
 *      under the same contention. Fixed in the READER (`argvOf`/`envOf` in lanes.test.ts,
 *      which now poll for the file rather than assume `launch`'s success implies every
 *      later line of this script has run).
 *   2. The ACTUAL registered flake (traced on main, predating this file entirely — the old
 *      shim's `json.dump(rows, open(p, "w"))` has the identical shape): `register_row`'s
 *      `printf ... > "$roster"` TRUNCATES the roster file before writing it, and `roster()`
 *      in lanes.sh pipes the file straight into `python3 -c 'json.load(sys.stdin)'` — a
 *      confirm poll that lands between truncate and write reads zero bytes, and python3
 *      crashes with `JSONDecodeError: Expecting value: line 1 column 1`, printed to stderr
 *      and (under lanes.sh's `set -e -o pipefail`) exiting the whole script non-zero. PROVEN:
 *      a tight reader/writer interleaving hit this on iteration 1 of 3000 against the old
 *      single-`printf` write; 0 across 4000 (two runs) once `register_row` wrote to a temp
 *      file and `mv -f`'d it onto the roster — `mv` is a fork, but it runs AFTER the content
 *      is complete, so a reader sees the old-complete or the new-complete file, never a
 *      truncated one (rename(2) is atomic within one directory/filesystem).
 *
 * `detach` spawns a grandchild through `setsid` before idling, so it survives the death of
 * the tmux session that started it — §15.100's RC-attached claude, plantable on demand.
 */
export function laneBin(
  dir: string,
  rosterFile: string,
  name: string,
  opts: { register: 'busy' | 'waiting' | 'never'; detach?: string },
) {
  const argvFile = join(dir, `${name}.argv`);
  const statusline =
    opts.register === 'waiting' ? '"waiting", "waitingFor": "permission prompt"' : '"busy"';
  const register =
    opts.register === 'never'
      ? ''
      : `register_row '${rosterFile}' "$SESS" "$$" '${statusline}'\n`;
  const detach = opts.detach
    ? `setsid nohup '${opts.detach}' 300 </dev/null >'${join(dir, `${name}.detached`)}' 2>&1 &
echo $! > '${join(dir, `${name}.detachedpid`)}'
`
    : '';
  return writeExec(
    dir,
    name,
    `#!/usr/bin/env bash
if [ "$1" = --version ]; then echo '0.0.0 (test)'; exit 0; fi
register_row() { local roster="$1" sess="$2" pid="$3" statusline="$4" existing body len row tmp; if [ -s "$roster" ]; then existing="$(< "$roster")"; else existing='[]'; fi; len=\${#existing}; body="\${existing:1:len-2}"; row="{\\"name\\": \\"$sess\\", \\"pid\\": $pid, \\"kind\\": \\"interactive\\", \\"status\\": $statusline}"; tmp="$roster.tmp.$$"; if [ -z "$body" ]; then printf '[%s]' "$row" > "$tmp"; else printf '[%s,%s]' "$body" "$row" > "$tmp"; fi; mv -f "$tmp" "$roster"; }
SESS=""; prev=""; for a in "$@"; do [ "$prev" = -n ] && SESS="$a"; prev="$a"; done
${register}printf '%s\\0' "$@" > '${argvFile}' # row 40
printenv > '${join(dir, `${name}.env`)}'
${detach}sleep 120
`,
  );
}
