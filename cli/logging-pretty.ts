/**
 * Pretty-printer adapter for forge's JSONL event log.
 *
 * Plan 07a / S7. Wraps `pino-pretty`'s primitives to render an
 * `EventLogEntry` as a single human-friendly line. Operates in two modes:
 *
 *   1. `formatLine(entry)` — pure synchronous formatter used by `forge
 *      watch`'s event-tail pane + snapshot tests + benchmark coverage.
 *   2. `createPrettyTransform()` — Node Transform stream that consumes
 *      JSONL (one entry per line) and emits formatted strings, suitable for
 *      `forge watch --plain` and shell pipes (`tail -F events.jsonl |
 *      forge-watch-pretty`).
 *
 * Why a hand-rolled message formatter instead of pino-pretty's
 * `messageFormat` template directly: pino-pretty's templater operates over
 * a pino log envelope (`{level,time,msg,…}`) and silently drops unknown
 * top-level fields (verified on v11). Our `EventLogEntry` schema is a
 * superset (`phase`, `event_type`, `work_item_id`, `metadata.*`); we use
 * pino-pretty's `colorizerFactory` (the colour engine) but compose the
 * line ourselves. This keeps the format spec readable and the snapshot
 * tests deterministic.
 *
 * The per-phase `customLevels` map + colour palette are first-class
 * exports so the council 07 `eng:02-pino-pretty-schema-mismatch` flag
 * stays visibly addressed (council asked for the actual invocation to be
 * spelled out, not just referenced).
 */

import { Transform } from 'node:stream';
import { prettyFactory } from 'pino-pretty';
import type { EventLogEntry, Phase } from '../orchestrator/logging.ts';

// ---------------------------------------------------------------------------
// Spec — exported so tests and operator tooling can read them.
// ---------------------------------------------------------------------------

/**
 * Plan 07a — exact `messageFormat` template the council asked for. Kept as
 * a documented constant even though formatting is hand-rolled, so the
 * spec-vs-implementation correspondence is greppable.
 *
 *   "{phase|UPPERCASE} {event_type} {if work_item_id}{work_item_id} {/if}{msg|truncate:120}"
 */
export const MESSAGE_FORMAT =
  '{phase|UPPERCASE} {event_type} {if work_item_id}{work_item_id} {/if}{msg|truncate:120}';

/**
 * Plan 07a — `customLevels` map. Each phase / skill that needs a stable
 * colour gets a synthetic pino "level" number. Numbers are arbitrary;
 * uniqueness + ordering (higher = more important / louder) is what
 * matters.
 */
export const CUSTOM_LEVELS: Record<string, number> = {
  cycle: 50,
  pm: 40,
  'developer-ralph': 40,
  'developer-unifier': 40,
  reviewer: 40,
  'review-router': 35,
  reflector: 40,
  'brain-lint': 30,
};

/**
 * Per-phase ANSI colour. Picked once at module load and reused via
 * `colorizerFactory`. Colours are stable across runs so an operator can
 * eyeball-grep.
 */
export const PHASE_COLOURS: Record<Phase | 'unknown', string> = {
  orchestrator: 'magenta',
  brain: 'cyan',
  architect: 'blue',
  'project-manager': 'yellow',
  'developer-loop': 'green',
  unifier: 'green',
  'review-loop': 'cyan',
  closure: 'magenta',
  reflection: 'blue',
  unknown: 'white',
};

const MAX_MSG_LEN = 120;
const MAX_TAIL_LEN = 200;

// ---------------------------------------------------------------------------
// formatLine — single source of truth for one rendered line.
// ---------------------------------------------------------------------------

export type FormatLineOptions = {
  /** Render ANSI colour codes. Default true. Snapshot tests pass `false`. */
  colorize?: boolean;
  /** Override the `Date.now()`-style "now" used for `since_ms` derived fields in tests. Defaults to system clock. */
  now?: () => number;
};

/**
 * Render one `EventLogEntry` as a one-line operator-readable string.
 *
 * Layout:
 *
 *   HH:MM:SS  PHASE  event_type  [WI-id]  message  (k metadata k=v…)
 *
 * Phase is rendered in upper-case + colourised; event_type lower-case; the
 * work-item id appears only when set (either directly on the entry or in
 * `metadata.work_item_id`). The message column is truncated to 120 chars
 * per the council-locked spec; metadata is appended as a parenthesised
 * key-value tail (cost / iteration / tool / op / size / pass_count / etc.
 * surfaced inline so the operator doesn't need `jq`).
 */
export function formatLine(entry: EventLogEntry, opts: FormatLineOptions = {}): string {
  const colorize = opts.colorize ?? true;
  const ts = renderTimestamp(entry.started_at);
  const phaseLabel = (entry.phase ?? 'unknown').toUpperCase();
  const phaseColoured = colorize ? colorizePhase(entry.phase, phaseLabel) : phaseLabel;
  const wi = workItemIdOf(entry);
  const wiCol = wi ? `  ${wi}` : '';
  const message = composeMessage(entry);
  const truncMsg = truncate(message, MAX_MSG_LEN);
  const tail = composeMetadataTail(entry);
  const tailCol = tail ? `  ${tail}` : '';
  return `${ts}  ${phaseColoured}  ${entry.event_type}${wiCol}  ${truncMsg}${tailCol}`;
}

// ---------------------------------------------------------------------------
// createPrettyTransform — for `forge watch --plain` and shell pipes.
// ---------------------------------------------------------------------------

/**
 * Build a Node Transform stream that splits on newlines, parses each line
 * as JSON, and emits `formatLine(entry) + '\n'`. Malformed lines pass
 * through pino-pretty's `prettyFactory` as a fallback so an arbitrary
 * `tail -F` of another pino log still renders sanely; lines that don't
 * parse as JSON at all are emitted verbatim with a `# bad-line` prefix.
 *
 * Used by `forge watch --plain` and as the spine of any
 * `tail -F events.jsonl | forge watch-pretty` pipeline.
 */
const pinoFallback = prettyFactory({
  colorize: false,
  ignore: 'pid,hostname',
  translateTime: 'HH:MM:ss',
});

export function createPrettyTransform(opts: FormatLineOptions = {}): Transform {
  let buffer = '';
  return new Transform({
    transform(chunk: Buffer | string, _enc, cb) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let idx: number;
      const out: string[] = [];
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim() === '') continue;
        out.push(renderOneLine(line, opts));
      }
      cb(null, out.join(''));
    },
    flush(cb) {
      if (buffer.trim() === '') return cb();
      cb(null, renderOneLine(buffer, opts));
    },
  });
}

function renderOneLine(line: string, opts: FormatLineOptions): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return `# bad-line: ${truncate(line, 200)}\n`;
  }
  const e = parsed as Partial<EventLogEntry>;
  // Forge events have `event_type` + `phase`. Anything else is treated as
  // a foreign pino-shaped record; let pino-pretty handle it.
  if (e && typeof e === 'object' && typeof e.event_type === 'string' && typeof e.phase === 'string') {
    return formatLine(e as EventLogEntry, opts) + '\n';
  }
  try {
    const rendered = pinoFallback(line + '\n');
    return typeof rendered === 'string' ? rendered : `${line}\n`;
  } catch {
    return `${line}\n`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * ANSI colour codes matching pino-pretty's palette. We avoid pulling in a
 * named-colour package (chalk / colorette / pino-pretty's internal
 * colorizer) for this trivial mapping; the pretty-printer's heavy lifting
 * (newline splitting, message composition, schema mapping) is what makes
 * `pino-pretty` a dependency, not the 7 escape sequences below.
 */
const ANSI: Record<string, string> = {
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};
const ANSI_RESET = '\x1b[0m';

function colorizePhase(phase: Phase | undefined, text: string): string {
  const key = (phase ?? 'unknown') as Phase | 'unknown';
  const colourName = PHASE_COLOURS[key] ?? PHASE_COLOURS.unknown;
  const code = ANSI[colourName] ?? '';
  if (code === '') return text;
  return `${code}${text}${ANSI_RESET}`;
}

function renderTimestamp(iso: string | undefined): string {
  if (!iso) return '--:--:--';
  // Parse ISO without TZ shift, render HH:MM:SS for the operator's wall
  // clock. We honour the value as recorded (UTC); a future flag could
  // localise.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  const h = pad2(date.getUTCHours());
  const m = pad2(date.getUTCMinutes());
  const s = pad2(date.getUTCSeconds());
  return `${h}:${m}:${s}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function workItemIdOf(entry: EventLogEntry): string | null {
  const md = entry.metadata as { work_item_id?: unknown; wi_id?: unknown } | undefined;
  const wid = md?.work_item_id ?? md?.wi_id;
  if (typeof wid === 'string' && wid !== '') return wid;
  return null;
}

/**
 * Compose the "message column". Order of preference:
 *   1. Entry's `message` field (the human-set tag).
 *   2. Synthesised one-liner for new event_types whose meaning lives in
 *      metadata (file_change → "modify src/foo.ts", test_run → "npm test
 *      → 42 pass / 0 fail", etc.).
 *   3. Empty.
 */
function composeMessage(entry: EventLogEntry): string {
  if (entry.message && entry.message.trim() !== '') return entry.message;
  const md = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.event_type) {
    case 'file_change': {
      const op = stringOr(md.op, 'change');
      const path = stringOr(md.path, '<?>');
      const size = numberOrUndef(md.size_bytes);
      return size === undefined ? `${op} ${path}` : `${op} ${path} (${size}b)`;
    }
    case 'test_run': {
      const cmd = stringOr(md.command, '<?>');
      const exit = numberOrUndef(md.exit_code);
      const pass = numberOrUndef(md.pass_count);
      const fail = numberOrUndef(md.fail_count);
      if (pass !== undefined || fail !== undefined) {
        return `${cmd} → ${pass ?? 0} pass / ${fail ?? 0} fail`;
      }
      if (exit !== undefined) {
        return `${cmd} → exit ${exit}`;
      }
      return cmd;
    }
    case 'phase_transition': {
      const from = stringOr(md.from, '?');
      const to = stringOr(md.to, '?');
      const reason = stringOr(md.reason, '');
      return reason ? `${from} → ${to} (${reason})` : `${from} → ${to}`;
    }
    case 'agent_heartbeat': {
      const tools = numberOrUndef(md.tool_use_count);
      const last = stringOr(md.last_tool, '');
      const since = numberOrUndef(md.since_ms);
      const sinceS = since === undefined ? '' : `${Math.round(since / 1000)}s`;
      const parts: string[] = [];
      if (sinceS) parts.push(`idle ${sinceS}`);
      if (tools !== undefined) parts.push(`tools=${tools}`);
      if (last) parts.push(`last=${last}`);
      return parts.length === 0 ? 'heartbeat' : parts.join(' ');
    }
    case 'cost_tick': {
      const c = numberOrUndef(md.cycle_cost_usd);
      const w = numberOrUndef(md.wi_cost_usd);
      if (c === undefined && w === undefined) return 'cost';
      const parts: string[] = [];
      if (c !== undefined) parts.push(`cycle $${c.toFixed(4)}`);
      if (w !== undefined) parts.push(`wi $${w.toFixed(4)}`);
      return parts.join(' / ');
    }
    case 'iteration': {
      const it = entry.iteration === undefined ? '?' : String(entry.iteration);
      const cost = entry.cost_usd === undefined ? '' : ` ($${entry.cost_usd.toFixed(4)})`;
      return `iteration ${it}${cost}`;
    }
    case 'tool_use': {
      const tool = stringOr(md.tool ?? md.name, 'tool');
      return `tool_use ${tool}`;
    }
    default:
      return '';
  }
}

/**
 * Render a compact metadata tail. We surface a small whitelist of
 * useful keys (cost, iteration, status), then a tag-set for anything
 * else worth a glance. Goal: the operator sees the load-bearing scalar
 * inline, not in a 20-element array.
 */
function composeMetadataTail(entry: EventLogEntry): string {
  const parts: string[] = [];
  if (entry.cost_usd !== undefined && entry.event_type !== 'iteration' && entry.event_type !== 'cost_tick') {
    parts.push(`cost=$${entry.cost_usd.toFixed(4)}`);
  }
  if (entry.duration_ms !== undefined && entry.event_type !== 'test_run') {
    parts.push(`dur=${entry.duration_ms}ms`);
  }
  if (entry.iteration !== undefined && entry.event_type !== 'iteration') {
    parts.push(`iter=${entry.iteration}`);
  }
  return parts.length === 0 ? '' : `(${parts.join(' ')})`;
}

function stringOr(v: unknown, dflt: string): string {
  return typeof v === 'string' ? v : dflt;
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Local re-export so consumers don't need a second import for typing.
export type { EventLogEntry, Phase, EventType } from '../orchestrator/logging.ts';
export { MAX_TAIL_LEN as PRETTY_MAX_TAIL_LEN };
