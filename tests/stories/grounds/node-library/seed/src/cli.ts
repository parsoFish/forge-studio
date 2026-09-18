#!/usr/bin/env node
/**
 * `mdtoc` CLI entry point.
 *
 * Usage:
 *   mdtoc <file.md>                 print the TOC for a file to stdout
 *   mdtoc --min 2 --max 3 <file>    only include H2..H3
 *   cat doc.md | mdtoc -            read markdown from stdin
 *
 * Reads markdown, renders the TOC (src/toc.ts), prints it. Validates argv at
 * the boundary and fails fast with a non-zero exit + a message on stderr — it
 * never silently swallows a bad flag or a missing file.
 */

import { readFileSync } from 'node:fs';

import { renderToc, type TocOptions } from './toc.ts';

export type CliResult = {
  /** Process exit code: 0 on success, non-zero on a usage/IO error. */
  readonly code: number;
  /** Text to write to stdout (the rendered TOC), if any. */
  readonly stdout: string;
  /** Text to write to stderr (usage / error), if any. */
  readonly stderr: string;
};

const USAGE = [
  'mdtoc — generate a Markdown table of contents',
  '',
  'Usage:',
  '  mdtoc <file.md>            print the TOC for a file',
  '  mdtoc -                   read markdown from stdin',
  '',
  'Options:',
  '  --min <n>   shallowest heading level to include (default 1)',
  '  --max <n>   deepest heading level to include (default 6)',
  '  --indent <n> spaces per nesting level (default 2)',
  '  --bullet <c> list bullet character (default "-")',
  '  -h, --help  show this help',
].join('\n');

/**
 * Pure arg → result core. `readStdin`/`readFile` are injected so this is fully
 * testable without touching the real filesystem or process streams.
 */
export function runCli(
  argv: readonly string[],
  io: { readStdin: () => string; readFile: (path: string) => string },
): CliResult {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    return { code: argv.length === 0 ? 1 : 0, stdout: '', stderr: USAGE };
  }

  const options: { -readonly [K in keyof TocOptions]: TocOptions[K] } = {};
  let source: string | null = null;
  let stdin = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--min':
      case '--max':
      case '--indent': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value)) {
          return { code: 2, stdout: '', stderr: `mdtoc: ${arg} requires an integer argument` };
        }
        if (arg === '--min') options.minLevel = value;
        else if (arg === '--max') options.maxLevel = value;
        else options.indent = value;
        break;
      }
      case '--bullet': {
        const value = argv[++i];
        if (value === undefined) {
          return { code: 2, stdout: '', stderr: 'mdtoc: --bullet requires an argument' };
        }
        options.bullet = value;
        break;
      }
      case '-':
        stdin = true;
        break;
      default:
        if (arg.startsWith('-')) {
          return { code: 2, stdout: '', stderr: `mdtoc: unknown option "${arg}"\n\n${USAGE}` };
        }
        if (source !== null) {
          return { code: 2, stdout: '', stderr: 'mdtoc: more than one input file given' };
        }
        source = arg;
    }
  }

  let markdown: string;
  try {
    markdown = stdin ? io.readStdin() : source !== null ? io.readFile(source) : '';
  } catch (err) {
    return {
      code: 1,
      stdout: '',
      stderr: `mdtoc: cannot read input: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!stdin && source === null) {
    return { code: 1, stdout: '', stderr: `mdtoc: no input file given\n\n${USAGE}` };
  }

  let toc: string;
  try {
    toc = renderToc(markdown, options);
  } catch (err) {
    return { code: 2, stdout: '', stderr: `mdtoc: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { code: 0, stdout: toc, stderr: '' };
}

/** Thin wrapper that wires `runCli` to the real process. */
export function main(argv: readonly string[]): number {
  const result = runCli(argv, {
    readStdin: () => readFileSync(0, 'utf8'),
    readFile: (path) => readFileSync(path, 'utf8'),
  });
  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  return result.code;
}

// Run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
