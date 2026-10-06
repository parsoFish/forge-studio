#!/usr/bin/env node
/**
 * docs-impact — Claude Code Stop hook (hook D, docs refactor W7). When the
 * session's changes touch code some published page `covers:`, no published
 * page changed, and the last assistant message carries no `Docs impact:` line,
 * it blocks the stop once with the pages to update, or asks for
 * `Docs impact: none — <reason>`. CLAUDE.md: "a user-facing change updates the
 * page whose covers: matches the code you changed, in the same PR".
 *
 * The session's changes: `git diff --name-only HEAD` (staged + unstaged),
 * untracked files, and the commits ahead of the branch's upstream when it has
 * one. The last message: `last_assistant_message` from the hook input when
 * present, else the last assistant text in `transcript_path`.
 *
 * Output: nothing + exit 0 to allow the stop; `{"decision":"block","reason":…}`
 * on stdout + exit 0 to continue the session with the reason. Exit 0 with no
 * output when `stop_hook_active` (already continued once — never loops).
 * Exit 1 with the cause on stderr when git or a page cannot be read: a
 * non-blocking error the operator sees, never a silent pass.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDocsPath, pagesCovering, readCoversMap } from '../docs-covers.mjs';

const MARKER = /Docs impact:/;

export function decide({ stopHookActive, changed, lastMessage, coversMap }) {
  if (stopHookActive) return { block: false };
  if (changed.some(isDocsPath)) return { block: false };
  if (typeof lastMessage === 'string' && MARKER.test(lastMessage)) return { block: false };
  const hits = pagesCovering(coversMap, changed);
  if (hits.length === 0) return { block: false };
  const list = hits
    .map(({ page, paths, generated }) =>
      `- ${page}${generated ? ' (generated — re-run its generator, never hand-edit)' : ''} covers ${paths.slice(0, 5).join(', ')}${paths.length > 5 ? ` and ${paths.length - 5} more` : ''}`)
    .join('\n');
  return {
    block: true,
    reason:
      `This session changed code that published pages cover, and no page changed:\n${list}\n` +
      'Update the page if the change is user-facing, or end your reply with `Docs impact: none — <reason>`.',
  };
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Changed repo-relative paths: working tree vs HEAD, untracked, and commits ahead of upstream. */
export function sessionChanges(cwd) {
  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = new Set([
    ...lines(git(cwd, ['diff', '--name-only', 'HEAD'])),
    ...lines(git(cwd, ['ls-files', '--others', '--exclude-standard'])),
  ]);
  let upstream = null;
  try {
    upstream = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).trim();
  } catch (err) {
    // No upstream configured (or a detached HEAD) is a state, not a failure:
    // git says so on stderr and the working tree is the whole session.
    if (!/no upstream|HEAD does not point to a branch|no such branch/i.test(String(err.stderr ?? ''))) throw err;
  }
  if (upstream) for (const p of lines(git(cwd, ['diff', '--name-only', `${upstream}...HEAD`]))) out.add(p);
  return [...out].sort();
}

/** The last assistant text block in a Claude Code transcript JSONL, or null. */
export function lastAssistantText(jsonl) {
  const rows = jsonl.split('\n').filter(Boolean);
  for (let i = rows.length - 1; i >= 0; i--) {
    let row;
    try {
      row = JSON.parse(rows[i]);
    } catch {
      continue; // a partially written last line is skipped, not fatal
    }
    if (row?.type !== 'assistant' || !Array.isArray(row.message?.content)) continue;
    const text = row.message.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
    if (text.trim() !== '') return text;
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch (err) {
    process.stderr.write(`docs-impact: unreadable hook input (invalid JSON: ${err.message})\n`);
    return process.exit(1);
  }
  if (input?.stop_hook_active === true) return process.exit(0);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || (typeof input.cwd === 'string' ? input.cwd : '');
  try {
    if (!projectDir) throw new Error('no CLAUDE_PROJECT_DIR and no cwd');
    let lastMessage = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : null;
    if (lastMessage === null && typeof input.transcript_path === 'string') {
      lastMessage = lastAssistantText(readFileSync(input.transcript_path, 'utf8'));
    }
    const result = decide({
      stopHookActive: false,
      changed: sessionChanges(projectDir),
      lastMessage,
      coversMap: readCoversMap(projectDir),
    });
    if (result.block) process.stdout.write(`${JSON.stringify({ decision: 'block', reason: result.reason })}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`docs-impact: could not judge docs impact (${String(err.message).split('\n')[0]}) — check covers: by hand\n`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
