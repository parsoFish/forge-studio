#!/usr/bin/env node
/**
 * Log one structured skill event to the JSONL event log.
 *
 *   node --experimental-strip-types scripts/skill-event.mjs <skill> <event> [key=value ...]
 *
 * Appends a `log` row to <repoRoot>/_logs/_skill-<skill>/events.jsonl (or
 * $FORGE_SKILL_EVENT_LOGS, an ABSOLUTE logs dir) and prints its event_id.
 * Exit 2 on any invalid input; nothing is written in that case.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../packages/kernel/logging.ts';

const NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const KEY = /^[a-z_][a-z0-9_]{0,31}$/;

function fail(msg) {
  process.stderr.write(`skill-event: ${msg}\n`);
  process.exit(2);
}

const [skill, event, ...pairs] = process.argv.slice(2);
if (skill === undefined || event === undefined) {
  fail('usage: skill-event.mjs <skill> <event> [key=value ...]');
}
if (!NAME.test(skill)) fail(`skill "${skill}" must match ${NAME}`);
if (!NAME.test(event)) fail(`event "${event}" must match ${NAME}`);

const metadata = {};
for (const pair of pairs) {
  const eq = pair.indexOf('=');
  if (eq < 0) fail(`argument "${pair}" is not key=value`);
  const key = pair.slice(0, eq);
  if (!KEY.test(key)) fail(`key "${key}" must match ${KEY}`);
  metadata[key] = pair.slice(eq + 1);
}

const override = process.env.FORGE_SKILL_EVENT_LOGS;
if (override !== undefined && !isAbsolute(override)) {
  fail('FORGE_SKILL_EVENT_LOGS must be an absolute path');
}
const logsDir = override ?? join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '_logs');

const logger = createLogger(`_skill-${skill}`, logsDir);
const row = logger.emit({
  initiative_id: logger.cycleId,
  phase: 'skill',
  skill,
  event_type: 'log',
  input_refs: [],
  output_refs: [],
  message: event,
  metadata,
});
process.stdout.write(`${row.event_id}\n`);
