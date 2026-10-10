/**
 * Plan-time validation of a `forge gate docs …` work-item gate (forge-nk1y.21).
 *
 * `apps/forge/cli-gate.ts` exits 2 ("unknown flag") on every `-`-prefixed
 * argument it does not know, so a gate like `["forge","gate","docs","--config=evil.md"]`
 * is permanently red and burns fix rounds. Refuse it where the WI is written,
 * naming the operand, instead of at run time. The grammar mirrors cli-gate:
 * `--sections <v>`, `--forbid <v>`, `--no-links`, and one `--` end-of-options
 * marker; every operand is a path of plain `[A-Za-z0-9._-]` segments.
 */

const VALUE_FLAGS = new Set(['--sections', '--forbid']);
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** True when `cmd` is a `forge gate docs …` invocation. */
export function isDocsGateCmd(cmd: readonly string[]): boolean {
  return cmd[0] === 'forge' && cmd[1] === 'gate' && cmd[2] === 'docs';
}

/** Why `operand` is not an acceptable doc path, or null when it is. */
function operandProblem(operand: string): string | null {
  if (operand.length === 0) return 'empty path';
  if (operand.startsWith('-')) return "leading '-' (parsed as a flag, never a document name)";
  const segments = operand.split('/');
  // A leading '/' (absolute path) yields one empty first segment, which is fine.
  const checked = segments[0] === '' && segments.length > 1 ? segments.slice(1) : segments;
  for (const seg of checked) {
    if (seg === '') return "empty path segment ('//' or trailing '/')";
    if (seg === '.' || seg === '..') return `'${seg}' path segment`;
    if (seg.startsWith('-')) return `path segment "${seg}" starts with '-'`;
    if (!SEGMENT.test(seg)) return `path segment "${seg}" has characters outside [A-Za-z0-9._-]`;
  }
  return null;
}

/** Error strings for a docs-gate argv; `[]` when `cmd` is not a docs gate or is well formed. */
export function docsGateArgvErrors(cmd: readonly string[]): string[] {
  if (!isDocsGateCmd(cmd)) return [];
  const errors: string[] = [];
  const refuseOperand = (operand: string, why: string): void => {
    errors.push(`quality_gate_cmd docs-gate operand ${JSON.stringify(operand)} refused: ${why}`);
  };
  let operands = 0;
  let endOfOptions = false;
  for (let i = 3; i < cmd.length; i++) {
    const a = cmd[i]!;
    if (!endOfOptions && a === '--') {
      endOfOptions = true;
    } else if (!endOfOptions && VALUE_FLAGS.has(a)) {
      const value = cmd[++i];
      if (value === undefined || value.length === 0 || value.startsWith('-')) {
        errors.push(
          `quality_gate_cmd docs-gate flag ${JSON.stringify(a)} refused: needs a non-empty value that does not start with '-' (got ${JSON.stringify(value ?? null)})`,
        );
      }
    } else if (!endOfOptions && a === '--no-links') {
      // known flag, no value
    } else if (!endOfOptions && a.startsWith('-')) {
      refuseOperand(a, 'unknown flag (forge gate docs knows --sections, --forbid, --no-links, --)');
    } else {
      operands++;
      const why = operandProblem(a);
      if (why !== null) refuseOperand(a, why);
    }
  }
  if (operands === 0) {
    errors.push('quality_gate_cmd docs-gate needs at least one document path operand');
  }
  return errors;
}
