/**
 * Argument parsing for `scripts/e2e-journey.mjs`, in its own module so it can be
 * tested without booting a browser — beads `forge-8vfn.7.6.40` and `.41`.
 *
 * WHY THIS EXISTS. The script used to read the flags it knew
 * (`process.argv.includes('--list')`, `indexOf('--journey')`) and DISCARD
 * everything else. So every unrecognised argument — a typo, an unsupported
 * flag, and above all `--help` — fell through to "run the whole suite", which
 * binds host-global 4123/4124, drives a browser and writes into `projects/`.
 *
 * It has now happened twice. The first time deleted 313 paths and wrote into a
 * tracked project; the second (2026-09-12, a sibling lane) launched the full
 * suite unlocked on the shared ports while another lane was working.
 *
 * §15.408: A DIAGNOSTIC THAT EXECUTES THE THING IT DIAGNOSES IS NOT A
 * DIAGNOSTIC. Asking a tool what it does is the safest thing an operator can
 * do, and here it was the most dangerous.
 *
 * An unknown flag is a statement that the caller believes something about this
 * tool that is not true. Running is the worst available response to that.
 */

/** Flags the runner understands. `--journey` is the only one taking a value. */
export const KNOWN_FLAGS = Object.freeze(['--help', '-h', '--list', '--journey']);
const VALUE_FLAGS = Object.freeze(['--journey']);

export const USAGE = `Usage: node scripts/e2e-journey.mjs [--list] [--journey <id>[,<id>...]] [--help]

  --help, -h            print this and exit WITHOUT running anything
  --list                print the journey/beat shape and exit
  --journey <id>[,...]  run only the named journeys (also E2E_JOURNEY=<id>[,...])

With no flags it runs the FULL suite: it binds host-global ports 4123/4124,
drives a real browser and writes into projects/. It takes the campaign
run-lock first and refuses if another lane holds it.`;

/**
 * Parse argv into an intent. Never throws and never runs anything: the caller
 * decides what to do with `kind`.
 *
 * @param {string[]} argv the arguments AFTER node and the script path
 * @returns {{kind:'help'|'list'|'run', journeys:string[]|null, error:string|null}}
 */
export function parseJourneyArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help', journeys: null, error: null };

  let journeys = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('-')) {
      // A bare word is only ever `--journey`'s value; anywhere else it is as
      // unexplained as an unknown flag and must not be shrugged off.
      if (i > 0 && VALUE_FLAGS.includes(args[i - 1])) continue;
      return { kind: 'run', journeys: null, error: `unexpected argument '${a}'. ${KNOWN_FLAGS.join(', ')} are the accepted flags.` };
    }
    if (!KNOWN_FLAGS.includes(a)) {
      return { kind: 'run', journeys: null, error: `unknown flag '${a}'. Accepted: ${KNOWN_FLAGS.join(', ')}. Nothing was run.` };
    }
    if (a === '--journey') {
      const raw = args[i + 1];
      if (raw === undefined || raw.startsWith('-')) {
        return { kind: 'run', journeys: null, error: `--journey needs a value: --journey <id>[,<id>...]. Nothing was run.` };
      }
      journeys = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (journeys.length === 0) {
        return { kind: 'run', journeys: null, error: `--journey was given an empty value. Nothing was run.` };
      }
      i += 1;
    }
  }
  if (args.includes('--list')) return { kind: 'list', journeys, error: null };
  return { kind: 'run', journeys, error: null };
}
