/**
 * Forge Studio hooks-library bridge routes — DETAIL read + edit
 * (R3-03-F4, carved out of `bridge-studio-hooks.ts` by forge-8vfn.5.39,
 * which sat AT the 800-line cap with zero headroom).
 *
 *   GET /api/studio/hooks/:id  → detail: entry fields + files + scan (D-4)
 *   PUT /api/studio/hooks/:id  → edit (W7-B4, library-08)
 *
 * The shared contract decisions (D-1..D-7), the id-resolution/containment
 * discipline, and the transport shape live in `bridge-studio-hooks.ts`'s own
 * header — that file stays this category's spec. `decodeIdSegment`,
 * `locateHook`, `parseCreatePermissions`, `hookWireFields` and `HOOK_ID_RE`
 * are IMPORTED from there (exported for exactly this reuse) rather than
 * duplicated, so id resolution, body validation and the wire projection
 * stay the ONE place each has always been.
 */

import type { AgentFacts } from './studio/agent-facts.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync } from 'node:fs';
import { resolveGuardedPath } from '@forge/kernel';
import yaml from 'js-yaml';

import {
  sendJson, allowedOrigin, sanitizeError, pathOnly, listCycles,
  guardedMtime, guardedReadFileTail, type StudioContext, type RouteContext,
} from '@forge/kernel';
import { assertSkillSlug } from '@forge/kernel/ids.ts';
import { scanHookFireSummary, HOOK_FIRE_SCAN_MAX_CYCLES } from './studio/hook-fire-summary.ts';
import {
  hooksDir,
  listHookLibrary,
  loadHookDefinition,
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  hookTriggerError,
} from './studio/hook-library.ts';
import { scanHookPackage } from './studio/hook-scan.ts';
import { hookRunState, readHookApprovalLedger, readHookDeclinedLedger } from './studio/hook-approval-ledger.ts';
// PIN E (2026-08-28 hostile review): the whole-package read/hash primitives
// the detail route's `files`/`packageHash` are built from — the SAME
// primitives the approval ledger's `packageHash` pin is computed from (see
// hook-package.ts's own header), so what this route lists and what the
// ledger pins are structurally the same file set, never two independently
// maintained views that can drift.
import { readHookPackage, hashHookPackage, hashHookScript } from './studio/hook-package.ts';
import { decodeIdSegment, locateHook, parseCreatePermissions, hookWireFields, HOOK_ID_RE } from './bridge-studio-hooks.ts';

/** Bytes of one cycle's `events.jsonl` the last-fire scan reads when the
 *  file is too big to read whole (mirrors `STDERR_TAIL_BYTES`). */
const HOOK_FIRE_SCAN_TAIL_BYTES = 64 * 1024;

/**
 * PUT /api/studio/hooks/:id — edit (W7-B4, library-08).
 *
 * Edits the definition fields and/or the script. An edit to an APPROVED
 * hook is legitimate — the pinned hashes no longer match, so hookRunState
 * honestly reads needs-review again; nothing here launders trust. The same
 * D-5/D-6 rules as create: no client script path, no binding keys.
 */
export async function handleHookUpdate(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const putMatch = url.match(HOOK_ID_RE);
  if (putMatch && method === 'PUT') {
    try {
      let id: string;
      try { id = decodeIdSegment(putMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      const located = locateHook(ctx.forgeRoot, id);
      if (!located.ok) { sendJson(res, located.status, { error: located.error }, origin); return true; }

      let body: unknown;
      try { body = await ctx.readBody(); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const b = (body ?? {}) as Record<string, unknown>;
      if (b === null || typeof b !== 'object' || Array.isArray(b)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin); return true;
      }
      for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
        if (key in b) {
          sendJson(res, 400, {
            error: `hook edit must not declare a binding field "${key}" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder`,
          }, origin);
          return true;
        }
      }

      // W7-B4 review finding 9: an ABSENT field means "leave it alone"; a
      // field that is PRESENT but empty is a request the route cannot honour.
      // Both used to collapse to the same `&& value` falsy test, so clearing
      // the editor answered ok:true and kept the old bytes — a save the
      // operator watched succeed and which changed nothing.
      for (const key of ['name', 'description', 'scriptBody'] as const) {
        if (key in b && (typeof b[key] !== 'string' || !(b[key] as string).trim())) {
          sendJson(res, 400, {
            error: `"${key}" was sent empty — send a non-empty value to change it, or omit the field to leave it unchanged`,
          }, origin);
          return true;
        }
      }

      const def = loadHookDefinition(id, ctx.forgeRoot);

      const name = typeof b['name'] === 'string' && b['name'].trim() ? b['name'].trim() : def.name;
      const description = typeof b['description'] === 'string' && b['description'].trim() ? b['description'].trim() : def.description;
      let on = def.on;
      if (b['on'] !== undefined) {
        if (typeof b['on'] !== 'string' || !(HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(b['on'])) {
          sendJson(res, 400, { error: `"on" must be one of ${HOOK_LIFECYCLE_EVENTS.join(', ')} — got "${String(b['on'])}"` }, origin);
          return true;
        }
        on = b['on'] as HookLifecycleEvent;
      }
      let matcher = def.matcher;
      if ('matcher' in b) {
        matcher = typeof b['matcher'] === 'string' && b['matcher'].trim() ? b['matcher'].trim() : undefined;
      }
      {
        const triggerError = hookTriggerError(on, matcher);
        if (triggerError) { sendJson(res, 400, { error: triggerError }, origin); return true; }
      }
      let permissions = def.permissions;
      if (b['permissions'] !== undefined) {
        const parsed = parseCreatePermissions(b['permissions']);
        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }, origin); return true; }
        permissions = parsed;
      }
      const scriptBody = typeof b['scriptBody'] === 'string' && b['scriptBody'] ? b['scriptBody'] : undefined;

      // Script leaf: the EXISTING declared script path, re-guarded segment by
      // segment (D-5: a client can never supply a script path).
      if (scriptBody !== undefined) {
        const scriptSegments = def.script.split('/').filter((s) => s !== '' && s !== '.');
        const scriptGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, ...scriptSegments]);
        if (!scriptGuard.ok || !scriptGuard.exists) {
          sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
          return true;
        }
        writeFileSync(scriptGuard.realPath, scriptBody, 'utf8');
      }

      const doc: Record<string, unknown> = {
        name,
        description,
        on,
        ...(matcher ? { matcher } : {}),
        script: def.script,
        permissions,
        // forge-8vfn.8.3.7: PRESERVE the existing origin marker across an
        // edit — this route rebuilds hook.yaml from structured fields
        // (never raw bytes), so an operator-created hook that omitted this
        // line would silently regress to reading "ootb" on its next save.
        ...(def.origin !== undefined ? { origin: def.origin } : {}),
      };
      writeFileSync(located.yamlPath, yaml.dump(doc), 'utf8');
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/** GET /api/studio/hooks/:id — detail (D-4: malformed reads as absent). */
export async function handleHookDetail(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string, facts: AgentFacts): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const detailMatch = url.match(HOOK_ID_RE);
  if (detailMatch && method === 'GET') {
    try {
      let id: string;
      try { id = decodeIdSegment(detailMatch[1]); } catch { sendJson(res, 400, { error: 'invalid hook id — malformed URL encoding' }, origin); return true; }
      try { assertSkillSlug(id, 'hook'); } catch (err) { sendJson(res, 400, { error: sanitizeError(err) }, origin); return true; }

      const entry = listHookLibrary(ctx.forgeRoot, facts).find((e) => e.id === id);
      if (!entry || entry.ok !== true) {
        sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
        return true;
      }

      // CONTAINMENT (unknown-hook 404, D-4): the two guards below establish
      // "this hook genuinely exists" — `listHookLibrary`'s dirent-type filter
      // excludes a symlinked hook DIR by accident, but not a symlinked or
      // hardlinked LEAF inside a real dir, and `entry.script` is a
      // hook.yaml-supplied relative path, so it is walked as segments rather
      // than joined blind.
      const yamlGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, 'hook.yaml']);
      // Split `script` into guard segments, dropping only the components that
      // carry no meaning — an empty string (from `scripts//run.sh`, which
      // `path.resolve` tolerates everywhere else, so rejecting it here would
      // 404 a perfectly valid hook) and `.`. A `..` is deliberately NOT
      // dropped: it must reach `isSafeSegment` and be rejected.
      const scriptSegments = entry.script.split('/').filter((s) => s !== '' && s !== '.');
      const scriptGuard = resolveGuardedPath(hooksDir(ctx.forgeRoot), [id, ...scriptSegments]);
      if (!yamlGuard.ok || !yamlGuard.exists || !scriptGuard.ok || !scriptGuard.exists) {
        sendJson(res, 404, { error: `unknown hook "${id}"` }, origin);
        return true;
      }
      // PIN E (2026-08-28 hostile review): the file BODIES are no longer read
      // through the two guards above alone. `readHookPackage` is the SAME
      // whole-package primitive the approval ledger's `packageHash` pin is
      // computed from — it walks and leaf-guards EVERY file under the
      // package directory on its own (independent of yamlGuard/scriptGuard,
      // which only establish "this id exists"), so what this route lists and
      // what the ledger pins are now, structurally, the same file set: no
      // sibling file can be invisible here while still counting toward the
      // pinned fingerprint. A planted symlink/socket/etc. leaf ANYWHERE in
      // the package makes `readHookPackage` THROW — refusing to silently omit
      // an unreadable file from a listing that claims to be complete — and
      // that throw is caught by this route's own try/catch below and
      // reported as a plain 500, exactly like any other unexpected failure
      // past this point (never a fabricated 200 with a partial file list).
      const packageFiles = readHookPackage(ctx.forgeRoot, id);
      const files = packageFiles.map((f) => ({ path: f.path, body: f.body, hash: hashHookScript(f.body) }));
      const packageHash = hashHookPackage(packageFiles);
      const scan = scanHookPackage(ctx.forgeRoot, id);
      const runState = hookRunState(ctx.forgeRoot, id);
      const ledgerEntry = readHookApprovalLedger(ctx.forgeRoot).get(id);
      const declinedEntry = readHookDeclinedLedger(ctx.forgeRoot).get(id);
      // forge-8vfn.5.16 (M7-C U2) — last-fire facts, BOUNDED via
      // @forge/kernel's guarded-scan.ts (rationale: docs/reference/
      // request-path-sinks.md's "M7-C U2" section). recentFireCount, not
      // fireCount: honestly a window count.
      const fireSummary = scanHookFireSummary(
        id,
        {
          listCycleIds: () => listCycles(ctx.logsRoot),
          mtimeOf: (cycleId) => guardedMtime(ctx.logsRoot, [cycleId]),
          readTail: (cycleId) => guardedReadFileTail(ctx.logsRoot, [cycleId, 'events.jsonl'], HOOK_FIRE_SCAN_TAIL_BYTES),
        },
        HOOK_FIRE_SCAN_MAX_CYCLES,
      );

      sendJson(res, 200, {
        ok: true,
        ...hookWireFields(entry, runState, ledgerEntry, declinedEntry),
        // Always present (0 = scanned, found none, like carriedByCount);
        // lastFireAt/lastFireOutcome stay ABSENT for no fire in the window.
        recentFireCount: fireSummary?.fireCount ?? 0,
        ...(fireSummary ? { lastFireAt: fireSummary.lastFireAt, lastFireOutcome: fireSummary.lastFireOutcome } : {}),
        // W7-B4 (library-09): the approval RECORD the resolved-state panel
        // renders — approvedAt + the distinct overridden act + its reason.
        // Present iff a live ledger entry exists; never fabricated.
        ...(ledgerEntry
          ? {
              approval: {
                approvedAt: ledgerEntry.approvedAt,
                overridden: ledgerEntry.overridden,
                ...(ledgerEntry.reason ? { reason: ledgerEntry.reason } : {}),
              },
            }
          : {}),
        // Same "present iff a live entry exists, never fabricated" discipline as `approval` above.
        ...(declinedEntry ? { declined: { declinedAt: declinedEntry.declinedAt, ...(declinedEntry.reason ? { reason: declinedEntry.reason } : {}) } } : {}),
        files,
        packageHash,
        scan,
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
