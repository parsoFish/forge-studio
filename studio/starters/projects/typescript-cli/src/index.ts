/**
 * {{TITLE}} — {{NORTH_STAR}}
 *
 * CLI entry point. Keep the core logic in small, pure, testable functions
 * (like `greet` below) and keep the argv/stdout plumbing thin so the quality
 * gate (`npm test`) exercises behaviour, not I/O.
 */

/** The one small piece of real behaviour this starter ships — replace it. */
export function greet(name: string): string {
  return `hello, ${name}`;
}

function main(argv: string[]): void {
  const name = argv[2] ?? 'world';
  process.stdout.write(greet(name) + '\n');
}

// Only run when invoked as the CLI, not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
