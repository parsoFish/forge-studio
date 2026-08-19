/**
 * W7-FIX-A2 (W7A2-03, SECURITY — closes bead forge-w08): a static, FAIL-CLOSED
 * inspector for `Bash` tool calls on a write-root-fenced interactive turn.
 *
 * `makeWriteRootCanUseTool` (orchestrator/interactive-session.ts) fences
 * Write/Edit/MultiEdit/NotebookEdit by resolving the ONE path each names.
 * Bash has no single path — its input is a shell script — so a fenced kind
 * that opts in (`turnSpec.bashFence: inspect`) gets THIS inspection instead:
 * the command string is tokenised with a small shell-word tokenizer, split
 * into simple commands, and every operation that could WRITE (a redirection,
 * a write-shaped utility's path operands, `dd of=`) must resolve INSIDE one
 * of the turn's write roots. Everything the inspector cannot reason about —
 * command/process/arithmetic substitution, brace expansion, `~`/`$VAR` in a
 * path position, subshells, unknown commands, interpreters, `sh -c`, `eval`,
 * `xargs`, `find -delete/-exec`, git writes, unbalanced quotes, NUL — is
 * DENIED, never guessed at. Only an allowlist of read-only utilities passes
 * without a path check.
 *
 * Deliberately hand-rolled rather than a shell-parser dependency: the design
 * is deny-on-doubt, so a tokenizer gap can only cause a FALSE DENY (the agent
 * gets a message and reaches for Write/Edit, which the fence already handles)
 * — never a false allow. Sound over complete.
 *
 * `cd` is tracked (relative paths in later segments resolve against the new
 * cwd) under a conservative model: `||` or a pipeline anywhere in a script
 * that also contains a `cd` is denied outright; after `cd X && …` the
 * &&-joined tail runs against X; every later segment (after `;`/newline/`&`)
 * runs against the SET {old cwds ∪ X} — the cd may have failed — and every
 * possible cwd must keep the write in-root.
 *
 * Pinned by orchestrator/bash-fence.test.ts.
 */

import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

export type BashInspection = { allow: true } | { allow: false; reason: string };

export type BashInspectContext = {
  /** The turn's working directory — relative paths resolve against it. */
  cwd: string;
  /** Already realpath-resolved, TRUSTED write roots (see makeWriteRootCanUseTool). */
  realWriteRoots: readonly string[];
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Word = {
  kind: 'word';
  text: string;
  /** Unquoted `$…` / leading `~` / glob / brace — value not knowable statically. */
  expands: boolean;
  /** Any part was quoted (a quoted heredoc delimiter, a quoted word). */
  quoted: boolean;
};
type Op = { kind: 'op'; op: string; fd?: number };
type Token = Word | Op;

const CONTROL_OPS = new Set(['&&', '||', '|', ';', '&', '\n']);
const WRITE_REDIRECT_OPS = new Set(['>', '>>', '>|', '&>', '&>>']);
const READ_REDIRECT_OPS = new Set(['<', '<<<']);
const HEREDOC_OPS = new Set(['<<', '<<-']);
const DUP_REDIRECT_OPS = new Set(['>&', '<&']);

class DenyError extends Error {}
const deny = (reason: string): never => { throw new DenyError(reason); };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const n = src.length;
  let i = 0;
  let pendingHeredocs: string[] = [];

  const readHeredocBodies = (): void => {
    // Called right after a newline: consume one body per pending delimiter.
    for (const delim of pendingHeredocs) {
      let terminated = false;
      while (i <= n) {
        let eol = src.indexOf('\n', i);
        if (eol === -1) eol = n;
        const line = src.slice(i, eol);
        i = Math.min(eol + 1, n + 1);
        if (line === delim || line.replace(/^\t+/, '') === delim) { terminated = true; break; }
        if (eol === n) break;
      }
      if (!terminated) deny(`unterminated heredoc (delimiter "${delim}")`);
    }
    pendingHeredocs = [];
    if (i > n) i = n;
  };

  while (i < n) {
    const c = src[i]!;
    if (c === '\u0000') deny('NUL byte in command');
    if (c === '\n') {
      tokens.push({ kind: 'op', op: '\n' });
      i += 1;
      if (pendingHeredocs.length > 0) readHeredocBodies();
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }
    if (c === '#') {
      // comment to end of line
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    // Operators (longest match first).
    const rest = src.slice(i, i + 3);
    if (rest.startsWith('&>>')) { tokens.push({ kind: 'op', op: '&>>' }); i += 3; continue; }
    if (rest.startsWith('<<<')) { tokens.push({ kind: 'op', op: '<<<' }); i += 3; continue; }
    if (rest.startsWith('<<-')) { tokens.push({ kind: 'op', op: '<<-' }); i += 3; continue; }
    if (rest.startsWith('&&')) { tokens.push({ kind: 'op', op: '&&' }); i += 2; continue; }
    if (rest.startsWith('||')) { tokens.push({ kind: 'op', op: '||' }); i += 2; continue; }
    if (rest.startsWith(';;')) deny('";;" (case syntax) is not reasoned about');
    if (rest.startsWith('>>')) { tokens.push({ kind: 'op', op: '>>' }); i += 2; continue; }
    if (rest.startsWith('>|')) { tokens.push({ kind: 'op', op: '>|' }); i += 2; continue; }
    if (rest.startsWith('&>')) { tokens.push({ kind: 'op', op: '&>' }); i += 2; continue; }
    if (rest.startsWith('>&')) { tokens.push({ kind: 'op', op: '>&' }); i += 2; continue; }
    if (rest.startsWith('<&')) { tokens.push({ kind: 'op', op: '<&' }); i += 2; continue; }
    if (rest.startsWith('<<')) { tokens.push({ kind: 'op', op: '<<' }); i += 2; continue; }
    if (rest.startsWith('<>')) deny('"<>" read-write redirection is not reasoned about');
    if (rest.startsWith('<(') || rest.startsWith('>(')) deny('process substitution is not reasoned about');
    if (c === '(' || c === ')') deny('subshell/grouping "(" ")" is not reasoned about');
    if (c === '|') { tokens.push({ kind: 'op', op: '|' }); i += 1; continue; }
    if (c === ';') { tokens.push({ kind: 'op', op: ';' }); i += 1; continue; }
    if (c === '&') { tokens.push({ kind: 'op', op: '&' }); i += 1; continue; }
    if (c === '<') { tokens.push({ kind: 'op', op: '<' }); i += 1; continue; }
    if (c === '>') { tokens.push({ kind: 'op', op: '>' }); i += 1; continue; }
    if (c === '`') deny('backtick command substitution is not reasoned about');

    // A word — possibly an fd-prefixed redirection like `2>` / `2>&1`.
    let text = '';
    let expands = false;
    let quoted = false;
    let sawChar = false;
    while (i < n) {
      const ch = src[i]!;
      if (ch === '\u0000') deny('NUL byte in command');
      if (/[\s;&|<>()`]/.test(ch)) {
        // An unquoted digit run directly followed by a redirection operator is an fd prefix.
        if ((ch === '>' || ch === '<') && !quoted && /^\d+$/.test(text) && sawChar) {
          const fd = Number.parseInt(text, 10);
          const two = src.slice(i, i + 2);
          if (two === '>>') { tokens.push({ kind: 'op', op: '>>', fd }); i += 2; }
          else if (two === '>&') { tokens.push({ kind: 'op', op: '>&', fd }); i += 2; }
          else if (two === '<&') { tokens.push({ kind: 'op', op: '<&', fd }); i += 2; }
          else if (two === '>|') { tokens.push({ kind: 'op', op: '>|', fd }); i += 2; }
          else if (two === '<<') deny('fd-prefixed heredoc is not reasoned about');
          else if (two === '<>') deny('"<>" read-write redirection is not reasoned about');
          else { tokens.push({ kind: 'op', op: ch, fd }); i += 1; }
          text = '';
          sawChar = false;
        }
        break;
      }
      sawChar = true;
      if (ch === "'") {
        const end = src.indexOf("'", i + 1);
        if (end === -1) deny('unbalanced single quote');
        text += src.slice(i + 1, end);
        quoted = true;
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        let closed = false;
        while (j < n) {
          const d = src[j]!;
          if (d === '\\' && j + 1 < n) { text += src[j + 1]; j += 2; continue; }
          if (d === '"') { closed = true; break; }
          if (d === '`') deny('backtick command substitution is not reasoned about');
          if (d === '$') {
            if (src[j + 1] === '(') deny('command/arithmetic substitution is not reasoned about');
            expands = true;
          }
          text += d;
          j += 1;
        }
        if (!closed) deny('unbalanced double quote');
        quoted = true;
        i = j + 1;
        continue;
      }
      if (ch === '\\') {
        if (i + 1 >= n) deny('trailing backslash');
        text += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '$') {
        if (src[i + 1] === '(') deny('command/arithmetic substitution is not reasoned about');
        expands = true;
      }
      if (ch === '~' && text.length === 0) expands = true;
      if (ch === '*' || ch === '?' || ch === '[' || ch === '{' || ch === '}') expands = true;
      text += ch;
      i += 1;
    }
    if (sawChar) {
      const prev = tokens[tokens.length - 1];
      if (prev !== undefined && prev.kind === 'op' && HEREDOC_OPS.has(prev.op)) {
        pendingHeredocs.push(text);
      }
      tokens.push({ kind: 'word', text, expands, quoted });
    }
  }
  if (pendingHeredocs.length > 0) {
    // Heredoc operator with no newline after it — bash would read an empty body from EOF; deny.
    deny('unterminated heredoc');
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Simple commands
// ---------------------------------------------------------------------------

type Redirect = { op: string; fd?: number; target: Word };
type SimpleCommand = { words: Word[]; redirects: Redirect[] };
type Segment = { command: SimpleCommand; /** operator that FOLLOWS this segment ('' at end) */ next: string; /** operator that PRECEDED it ('' at start) */ prev: string };

function splitSegments(tokens: Token[]): Segment[] {
  const segments: Segment[] = [];
  let words: Word[] = [];
  let redirects: Redirect[] = [];
  let prev = '';
  let i = 0;
  const flush = (next: string): void => {
    if (words.length === 0 && redirects.length === 0) {
      if (next === '\n' || next === '' || next === ';') return; // blank line / trailing separator
      deny(`empty command before "${next}"`);
    }
    if (words.length === 0) deny('redirection with no command');
    segments.push({ command: { words, redirects }, next, prev });
    words = [];
    redirects = [];
    prev = next;
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === 'word') { words.push(t); i += 1; continue; }
    if (CONTROL_OPS.has(t.op)) { flush(t.op); i += 1; continue; }
    // A redirection operator: needs a target word (dup ops may target a fd number or '-').
    const target = tokens[i + 1];
    if (target === undefined || target.kind !== 'word') {
      return deny(`redirection "${t.op}" without a target`);
    }
    redirects.push({ op: t.op, fd: t.fd, target });
    i += 2;
  }
  flush('');
  // Blank-line separators are noise for control-flow analysis: collapse '\n' → ';'.
  return segments.map((s) => ({ ...s, next: s.next === '\n' ? ';' : s.next, prev: s.prev === '\n' ? ';' : s.prev }));
}

// ---------------------------------------------------------------------------
// Path resolution against a SET of possible cwds
// ---------------------------------------------------------------------------

const DEVICE_SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

/** realpath of the deepest EXISTING ancestor + the literal remainder — so a
 *  not-yet-created `staging/scripts/run.sh` resolves lexically below its
 *  real root, while an in-root symlink to an outside dir is followed and
 *  caught. */
function realish(p: string): string | null {
  let probe = p;
  const remainder: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(probe);
      return remainder.length === 0 ? real : join(real, ...remainder.reverse());
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return null;
      remainder.push(basename(probe));
      probe = parent;
    }
  }
}

function isUnderRoot(realPath: string, roots: readonly string[]): boolean {
  return roots.some((root) => realPath === root || realPath.startsWith(root + sep));
}

/** A path WORD in a write position: literal only, resolved against EVERY possible cwd, all in-root. */
function assertWritablePath(word: Word, cwds: readonly string[], roots: readonly string[], what: string): void {
  if (word.expands) deny(`${what} "${word.text}" contains an expansion ($VAR, ~, glob or brace) — not statically resolvable`);
  if (word.text.length === 0) deny(`${what} is empty`);
  if (DEVICE_SINKS.has(word.text)) return;
  for (const cwd of cwds) {
    const abs = isAbsolute(word.text) ? resolve(word.text) : resolve(cwd, word.text);
    const real = realish(abs);
    if (real === null || !isUnderRoot(real, roots)) {
      deny(`${what} "${word.text}" resolves outside the session's write root(s)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Command policy
// ---------------------------------------------------------------------------

const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'wc', 'du', 'df', 'echo', 'printf',
  'true', 'false', 'test', '[', 'pwd', 'which', 'type', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp',
  'file', 'stat', 'basename', 'dirname', 'realpath', 'readlink', 'date', 'whoami', 'id', 'uname',
  'printenv', 'seq', 'sleep', 'tree', 'md5sum', 'sha1sum', 'sha256sum', 'column', 'paste', 'comm',
  'nl', 'tac', 'less', 'more', 'jq', 'yq', 'strings', 'od', 'xxd', 'hexdump', 'expr', 'yes', 'tput', 'clear', 'find',
]);

const FIND_DENIED_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);

const GIT_READ_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'blame', 'grep', 'shortlog', 'describe', 'rev-list', 'name-rev', 'for-each-ref', 'check-ignore']);
const GIT_BRANCH_LIST_FLAGS = new Set(['--list', '-a', '-r', '--show-current', '-v', '-vv', '--all']);

/** Write-shaped utilities and how their operands are read. `argFlags` consume
 *  the next word (never a path); `deniedFlagChars` are single-letter flags
 *  (in any bundle) that change the semantics beyond what the inspector
 *  models (recursive copy, link creation, target-directory, reference). */
type WriteCmdSpec = {
  positional: 'all' | 'last' | 'skip-first';
  argFlags?: ReadonlySet<string>;
  deniedFlagChars?: string;
  deniedLongFlags?: ReadonlySet<string>;
  /** When set, ONLY these `-` words are flags — any other `-`-leading word
   *  is an OPERAND (chmod's `-x` is a MODE, not a flag, and must not hide
   *  the path that follows it from the check). */
  allowedFlags?: ReadonlySet<string>;
};
const WRITE_COMMANDS: Record<string, WriteCmdSpec> = {
  mkdir: { positional: 'all', argFlags: new Set(['-m', '--mode']) },
  rmdir: { positional: 'all' },
  touch: { positional: 'all', deniedFlagChars: 'dtrh', deniedLongFlags: new Set(['--date', '--reference', '--time', '--no-dereference']) },
  rm: { positional: 'all' },
  truncate: { positional: 'all', argFlags: new Set(['-s', '--size']), deniedFlagChars: 'r', deniedLongFlags: new Set(['--reference']) },
  chmod: { positional: 'skip-first', allowedFlags: new Set(['-R', '-v', '-f', '-c', '--recursive', '--verbose', '--changes', '--silent', '--quiet']), deniedLongFlags: new Set(['--reference']) },
  tee: { positional: 'all' },
  cp: { positional: 'last', deniedFlagChars: 'rRalsLPHt', deniedLongFlags: new Set(['--recursive', '--archive', '--link', '--symbolic-link', '--target-directory', '--dereference', '--no-dereference', '--reflink']) },
  mv: { positional: 'all', deniedFlagChars: 't', deniedLongFlags: new Set(['--target-directory']) },
};

function inspectWriteCommand(name: string, spec: WriteCmdSpec, args: Word[], cwds: readonly string[], roots: readonly string[]): void {
  const operands: Word[] = [];
  let endOfFlags = false;
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i]!;
    if (!endOfFlags && !w.quoted && w.text === '--') { endOfFlags = true; continue; }
    if (!endOfFlags && !w.quoted && w.text.startsWith('-') && w.text.length > 1) {
      if (spec.argFlags?.has(w.text)) { i += 1; continue; }
      if (spec.allowedFlags !== undefined) {
        const bare = w.text.split('=')[0]!;
        if (spec.deniedLongFlags?.has(bare)) deny(`${name} ${w.text} is not reasoned about`);
        if (spec.allowedFlags.has(w.text)) continue;
        operands.push(w); // a `-`-leading OPERAND (e.g. a chmod mode)
        continue;
      }
      if (w.text.startsWith('--')) {
        const bare = w.text.split('=')[0]!;
        if (spec.deniedLongFlags?.has(bare)) deny(`${name} ${w.text} is not reasoned about`);
        if (spec.argFlags?.has(bare)) continue; // --flag=value form
        continue;
      }
      if (spec.deniedFlagChars !== undefined) {
        for (const ch of w.text.slice(1)) {
          if (spec.deniedFlagChars.includes(ch)) deny(`${name} -${ch} is not reasoned about`);
        }
      }
      continue;
    }
    operands.push(w);
  }
  if (operands.length === 0) deny(`${name} without operands`);
  if (spec.positional === 'all') {
    for (const op of operands) assertWritablePath(op, cwds, roots, `${name} target`);
  } else if (spec.positional === 'last') {
    if (operands.length < 2) deny(`${name} needs a source and a destination`);
    assertWritablePath(operands[operands.length - 1]!, cwds, roots, `${name} destination`);
  } else {
    for (const op of operands.slice(1)) assertWritablePath(op, cwds, roots, `${name} target`);
  }
}

function inspectGit(args: Word[]): void {
  let i = 0;
  while (i < args.length && args[i]!.text.startsWith('-')) {
    const w = args[i]!;
    if (w.text === '-C') { i += 2; continue; }
    if (w.text === '--no-pager') { i += 1; continue; }
    deny(`git global option ${w.text} is not reasoned about`);
  }
  const sub = args[i]?.text;
  if (sub === undefined) deny('git without a subcommand');
  const rest = args.slice(i + 1);
  for (const w of rest) {
    if (w.text.startsWith('--output') || w.text === '-o') deny(`git ${sub} ${w.text} writes a file`);
  }
  if (GIT_READ_SUBCOMMANDS.has(sub!)) return;
  if (sub === 'branch' && rest.every((w) => GIT_BRANCH_LIST_FLAGS.has(w.text))) return;
  if (sub === 'tag' && rest.every((w) => w.text === '-l' || w.text === '--list')) return;
  if (sub === 'remote' && rest.every((w) => w.text === '-v' || w.text === 'show')) return;
  deny(`git ${sub} is not a read-only subcommand`);
}

function inspectDd(args: Word[], cwds: readonly string[], roots: readonly string[]): void {
  for (const w of args) {
    const eq = w.text.indexOf('=');
    if (eq <= 0) deny(`dd operand "${w.text}" is not key=value`);
    const key = w.text.slice(0, eq);
    if (key === 'of') {
      assertWritablePath({ ...w, text: w.text.slice(eq + 1) }, cwds, roots, 'dd of=');
    }
  }
}

function inspectFind(args: Word[]): void {
  for (const w of args) {
    if (FIND_DENIED_ACTIONS.has(w.text)) deny(`find ${w.text} is a write action`);
  }
}

// ---------------------------------------------------------------------------
// The inspector
// ---------------------------------------------------------------------------

/**
 * Statically inspect one Bash `command` string against the write roots.
 * `allow: true` only when every write-shaped operation provably targets a
 * path inside `realWriteRoots` and every command is a known read-only or
 * modelled write utility. Never throws — a tokenizer/parse problem is a deny.
 */
export function inspectBashCommand(command: string, ctx: BashInspectContext): BashInspection {
  try {
    if (typeof command !== 'string' || command.trim().length === 0) deny('empty command');
    const segments = splitSegments(tokenize(command));
    if (segments.length === 0) deny('empty command');
    const hasCd = segments.some((s) => s.command.words[0]?.text === 'cd');
    if (hasCd && segments.some((s) => s.next === '||' || s.next === '|' || s.prev === '||' || s.prev === '|')) {
      deny('a `cd` combined with `||` or a pipeline is not reasoned about');
    }
    const roots = ctx.realWriteRoots;
    /** Possible cwds for the CURRENT segment. */
    let cwds: string[] = [resolve(ctx.cwd)];
    /** Set that segments after the current &&-chain fall back to (old ∪ cd targets). */
    let fallback: string[] = cwds;

    for (const seg of segments) {
      const { words, redirects } = seg.command;
      // Redirections are evaluated against the pre-command cwd set.
      for (const r of redirects) {
        if (WRITE_REDIRECT_OPS.has(r.op)) {
          assertWritablePath(r.target, cwds, roots, 'redirection target');
        } else if (DUP_REDIRECT_OPS.has(r.op)) {
          if (!/^\d+$|^-$/.test(r.target.text) || r.target.expands) {
            // `>& file` is a write to file.
            if (r.op === '>&') assertWritablePath(r.target, cwds, roots, 'redirection target');
            else deny(`"${r.op} ${r.target.text}" is not reasoned about`);
          }
        } else if (READ_REDIRECT_OPS.has(r.op) || HEREDOC_OPS.has(r.op)) {
          if (r.target.expands && r.op === '<') deny(`input redirection "${r.target.text}" contains an expansion`);
        } else {
          deny(`redirection "${r.op}" is not reasoned about`);
        }
      }
      // Leading NAME=value assignments are an environment prefix.
      let k = 0;
      while (k < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]!.text) && !words[k]!.quoted) k += 1;
      const cmdWord = words[k];
      if (cmdWord === undefined) {
        deny('assignment-only command is not reasoned about');
      }
      if ((cmdWord!.expands && cmdWord!.text !== '[') || cmdWord!.quoted) deny(`command name "${cmdWord!.text}" is not a plain literal`);
      const name = cmdWord!.text;
      const args = words.slice(k + 1);

      if (name === 'cd') {
        if (args.length !== 1) deny('cd needs exactly one operand');
        const target = args[0]!;
        if (target.expands || target.text.startsWith('-')) deny(`cd target "${target.text}" is not statically resolvable`);
        const targets = cwds.map((c) => resolve(c, target.text));
        for (const t of targets) {
          const real = realish(t);
          if (real === null) deny(`cd target "${target.text}" cannot be resolved`);
        }
        fallback = [...new Set([...fallback, ...targets])];
        cwds = seg.next === '&&' ? targets : fallback;
        continue;
      }
      if (name === 'git') inspectGit(args);
      else if (name === 'dd') inspectDd(args, cwds, roots);
      else if (name === 'find') inspectFind(args);
      else if (READ_ONLY_COMMANDS.has(name)) { /* reads: no path check */ }
      else if (Object.prototype.hasOwnProperty.call(WRITE_COMMANDS, name)) inspectWriteCommand(name, WRITE_COMMANDS[name]!, args, cwds, roots);
      else deny(`command "${name}" is not on the fenced-Bash allowlist`);

      // The &&-chain after a cd keeps the cd's cwd set; once the chain ends
      // (`;`, `&`, end) the cd may not have run — widen back to the fallback.
      if (seg.next !== '&&') cwds = fallback;
    }
    return { allow: true };
  } catch (e) {
    if (e instanceof DenyError) return { allow: false, reason: e.message };
    return { allow: false, reason: `inspector error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
