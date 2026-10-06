#!/usr/bin/env node
/**
 * docs-budget — Claude Code PostToolUse hook (hook B, docs refactor W7): after
 * an edit to a published page, re-count its prose words and block with the
 * overage when the page is over its R22 ceiling, so the agent trims in the
 * same turn instead of meeting `check-docs-budget --strict` in CI.
 *
 * Input: the hook JSON on stdin ({"tool_name":"Edit","tool_input":{"file_path":…},"cwd":…}).
 * Only Write/Edit/MultiEdit on apps/docs/src/content/**\/*.{md,mdx} are judged;
 * counting and ceilings come from scripts/check-docs-budget.mjs.
 *
 * Exit: 0 = within budget or not a site page (no output) · 2 = over budget
 * (overage on stderr, shown to Claude) or unreadable input / page (fail closed).
 */
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CEILINGS, countWords, pageType, splitFrontmatter } from '../check-docs-budget.mjs';

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const SITE_CONTENT = 'apps/docs/src/content/';

export function decide({ toolName, filePath, projectDir, readFile }) {
  if (!TOOLS.has(toolName)) return { block: false };
  const rel = relative(projectDir, resolve(projectDir, filePath)).split(sep).join('/');
  if (rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith(SITE_CONTENT) || !/\.mdx?$/.test(rel)) {
    return { block: false };
  }
  const src = readFile(resolve(projectDir, rel));
  if (src === null) return { block: true, message: `docs-budget: cannot read ${rel} after the edit — refusing rather than guessing` };
  const type = pageType(rel, splitFrontmatter(src).frontmatter);
  if (!Object.hasOwn(CEILINGS, type)) return { block: false };
  const words = countWords(src);
  const ceiling = CEILINGS[type];
  if (words <= ceiling) return { block: false };
  return {
    block: true,
    message:
      `${rel}: ${words} prose words, ceiling ${ceiling} for a ${type} page — ${words - ceiling} over. ` +
      'Cut it now: delete what the reader does not need, or split the page by task. Never raise a ceiling (R22).',
  };
}

function readOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'EISDIR') return null;
    throw err;
  }
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
    return block(`docs-budget: unreadable hook input (invalid JSON: ${err.message})`);
  }
  if (!TOOLS.has(input?.tool_name)) return process.exit(0);
  const filePath = input.tool_input?.file_path;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || (typeof input.cwd === 'string' ? input.cwd : '');
  if (typeof filePath !== 'string' || filePath === '' || !projectDir) {
    return block('docs-budget: unreadable hook input (no file_path or project dir)');
  }
  let result;
  try {
    result = decide({ toolName: input.tool_name, filePath, projectDir, readFile: readOrNull });
  } catch (err) {
    return block(`docs-budget: cannot inspect ${filePath}: ${err.message}`);
  }
  if (result.block) return block(result.message);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
