#!/usr/bin/env node
/**
 * line-cap — Claude Code PostToolUse hook (hook C, docs refactor W7): after an
 * edit to the root CLAUDE.md, block when it is over CLAUDE_MD_LINE_CAP lines,
 * so the agent cuts in the same turn. The cap and the line count are
 * check-stale-path-citations' own (the CI check), never a second copy.
 *
 * Exit: 0 = within the cap or not the root CLAUDE.md · 2 = over the cap, or
 * unreadable input (fail closed). Message on stderr, shown to Claude.
 */
import { readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MD_LINE_CAP, claudeMdLines } from '../check-stale-path-citations.mjs';

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

export function decide({ toolName, filePath, projectDir, countLines }) {
  if (!TOOLS.has(toolName)) return { block: false };
  const rel = relative(projectDir, resolve(projectDir, filePath)).split(sep).join('/');
  if (rel !== 'CLAUDE.md') return { block: false };
  const lines = countLines(projectDir);
  if (lines === null) return { block: true, message: 'line-cap: CLAUDE.md is missing after the edit — refusing rather than guessing' };
  if (lines <= CLAUDE_MD_LINE_CAP) return { block: false };
  return {
    block: true,
    message:
      `CLAUDE.md: ${lines} lines, cap ${CLAUDE_MD_LINE_CAP} — ${lines - CLAUDE_MD_LINE_CAP} over. ` +
      'Every session pays for each line: move area detail to .claude/rules/ or delete lines a session does not need.',
  };
}

function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch (err) {
    return block(`line-cap: unreadable hook input (invalid JSON: ${err.message})`);
  }
  if (!TOOLS.has(input?.tool_name)) return process.exit(0);
  const filePath = input.tool_input?.file_path;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || (typeof input.cwd === 'string' ? input.cwd : '');
  if (typeof filePath !== 'string' || filePath === '' || !projectDir) {
    return block('line-cap: unreadable hook input (no file_path or project dir)');
  }
  let result;
  try {
    result = decide({ toolName: input.tool_name, filePath, projectDir, countLines: claudeMdLines });
  } catch (err) {
    return block(`line-cap: cannot read CLAUDE.md: ${err.message}`);
  }
  if (result.block) return block(result.message);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
