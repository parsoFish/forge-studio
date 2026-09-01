/**
 * `kind:'hook'` install strategy for the studio-authoring finalize route.
 * Split out of `bridge-studio-authoring.ts` (M4-library PR 4b) — see that
 * file's header for the full route contract this strategy is one arm of.
 *
 * `sanitizeError` rides in as a parameter (never a direct `cli/` import)
 * because that would make this a NEW importer of `cli/bridge-studio.ts` —
 * the retained route file already imports it and passes it down.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import yaml from 'js-yaml';
import { resolveGuardedPath, guardedFile, guardedReadFile } from '@forge/kernel';
import { MAX_PACKAGE_FILES, MAX_PACKAGE_BYTES } from './studio/skill-package.ts';
import {
  hookDir,
  hooksDir,
  hookTriggerError,
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  type HookLifecycleEvent,
  type HookPermissionManifest,
} from './studio/hook-library.ts';
import { reqString, optString, oneOf } from '@forge/kernel/studio/yaml-fields.ts';
import { INTERACTIVE_LIBRARY_DIRNAME, type InstallOutcome } from './bridge-studio-authoring-types.ts';

function parseFinalizeHookPermissions(raw: unknown): HookPermissionManifest | { error: string } {
  if (raw === undefined) return { env: [], read: [], network: false };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'hook.yaml permissions must be an object' };
  }
  const p = raw as Record<string, unknown>;
  const env = p['env'];
  const read = p['read'];
  const network = p['network'];
  if (env !== undefined && (!Array.isArray(env) || !env.every((x) => typeof x === 'string'))) {
    return { error: 'hook.yaml permissions.env must be an array of strings' };
  }
  if (read !== undefined && (!Array.isArray(read) || !read.every((x) => typeof x === 'string'))) {
    return { error: 'hook.yaml permissions.read must be an array of strings' };
  }
  if (network !== undefined && typeof network !== 'boolean') {
    return { error: 'hook.yaml permissions.network must be a boolean' };
  }
  return {
    env: Array.isArray(env) ? (env as string[]) : [],
    read: Array.isArray(read) ? (read as string[]) : [],
    network: network === true,
  };
}

// ---------------------------------------------------------------------------
// kind:"hook" — hook METADATA comes from the LANDED, DRAFTED hook.yaml,
// parsed server-side, never from parallel request-body fields.
// ---------------------------------------------------------------------------

/** One file discovered under the landed package, relative to
 *  `_interactive-library/<id>/` (segments, never a raw joined string — every
 *  destination re-derived from `relParts` rides through the guard as its own
 *  `segments[]` elements, matching this whole module's containment
 *  convention). */
type LandedHookFile = { relParts: string[]; body: string };

/**
 * Enumerate EVERY regular file under `<forgeRoot>/_interactive-library/<id>/`,
 * recursively, through the guard — the fix for counter-repro C / S2: the
 * former code read exactly `hook.yaml` and `scripts/run.sh` off this tree by
 * hardcoded path and silently dropped every other staged file (a README, a
 * sourced `scripts/lib.sh`, ...) while the route still answered
 * `200 {ok:true}`. Every directory is opened via
 * `guardedFile(..., 'readdir')` (which itself requires the entry to be a REAL
 * directory — never a symlink masquerading as one, mirrors
 * `readVendoredPackage`'s own walk-and-guard-every-leaf pattern in
 * `orchestrator/studio/community-index.ts`); every leaf's bytes are read via
 * `guardedReadFile`. Throws a plain `Error` NAMING the first offending entry
 * — never a silent drop — when: an entry is neither a regular file nor a
 * directory (symlink/socket/fifo); a leaf fails the guarded read; the file
 * count exceeds `MAX_PACKAGE_FILES`; or the total bytes exceed
 * `MAX_PACKAGE_BYTES` (the SAME caps `installSkillPackage` /
 * `installCommunityHookPackage` enforce — reused, never retyped). The caller
 * maps this to a 400.
 */
function enumerateLandedHookFiles(forgeRoot: string, id: string): LandedHookFile[] {
  const out: LandedHookFile[] = [];

  function walk(relParts: string[]): void {
    const dirPath = guardedFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, ...relParts], 'readdir');
    if (dirPath === null) {
      throw new Error(
        `landed hook package "${id}": directory "${relParts.join('/') || '.'}" could not be read (missing or fails containment)`,
      );
    }
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const nextRelParts = [...relParts, entry.name];
      const label = nextRelParts.join('/');
      if (entry.isDirectory()) {
        walk(nextRelParts);
        continue;
      }
      if (!entry.isFile()) {
        // A symlink, socket, FIFO, device node, etc. — never silently skip it.
        throw new Error(`landed hook package "${id}": staged entry "${label}" is neither a regular file nor a directory — refusing`);
      }
      const body = guardedReadFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, ...nextRelParts]);
      if (body === null) {
        throw new Error(`landed hook package "${id}": staged entry "${label}" could not be read (fails containment)`);
      }
      out.push({ relParts: nextRelParts, body });
    }
  }

  walk([]);

  if (out.length > MAX_PACKAGE_FILES) {
    throw new Error(`landed hook package "${id}" has ${out.length} files, exceeding the ${MAX_PACKAGE_FILES}-file cap`);
  }
  const totalBytes = out.reduce((sum, f) => sum + Buffer.byteLength(f.body, 'utf8'), 0);
  if (totalBytes > MAX_PACKAGE_BYTES) {
    throw new Error(`landed hook package "${id}" exceeds the ${MAX_PACKAGE_BYTES}-byte cap`);
  }

  return out;
}

export function finalizeHookFromLanded(forgeRoot: string, id: string, sanitizeError: (err: unknown) => string): InstallOutcome {
  // Step 1 fix (counter-repro C / S2) — enumerate the WHOLE landed package
  // FIRST, before any hook.yaml-shape validation below: `landedFiles` is the
  // full, honest manifest this function now works from, never a hand-picked
  // pair of paths. Message built directly from `err.message`, NEVER
  // `sanitizeError`: `enumerateLandedHookFiles` only ever names
  // package-relative paths ("scripts/lib.sh"), never a host absolute path —
  // there is nothing for `sanitizeError`'s `/\/[^\s:,'"]+/g` redaction regex
  // to legitimately catch here, and running it anyway is exactly what turns
  // "scripts/evil.sh" into the unreadable "scripts[path]" (the S3 defect this
  // same review round fixed at the `runFinalize` catch — see below).
  let landedFiles: LandedHookFile[];
  try {
    landedFiles = enumerateLandedHookFiles(forgeRoot, id);
  } catch (err) {
    return { ok: false, status: 400, error: (err as Error).message };
  }

  const hookYamlFile = landedFiles.find((f) => f.relParts.join('/') === 'hook.yaml');
  if (!hookYamlFile) {
    return { ok: false, status: 400, error: `drafted hook.yaml is missing from the landed package "${id}"` };
  }
  const yamlRaw = hookYamlFile.body;

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlRaw);
  } catch (err) {
    return { ok: false, status: 400, error: `drafted hook.yaml is not valid YAML: ${sanitizeError(err)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'drafted hook.yaml must be a YAML mapping (object), not a scalar/array/null' };
  }
  const doc = parsed as Record<string, unknown>;

  // The SAME forbidden-binding-key rejection POST /api/studio/hooks
  // enforces, checked BEFORE any filesystem write — now against the LANDED
  // hook.yaml's own fields.
  for (const key of FORBIDDEN_HOOK_BINDING_KEYS) {
    if (key in doc) {
      return {
        ok: false,
        status: 400,
        error: `drafted hook.yaml must not declare a binding field "${key}" — a library hook definition is generic and host-agnostic; binding happens only in the Agent Builder`,
      };
    }
  }

  let name: string;
  let description: string;
  let on: HookLifecycleEvent;
  try {
    name = reqString(doc, 'name', 'hook.yaml');
    description = reqString(doc, 'description', 'hook.yaml');
    on = oneOf(reqString(doc, 'on', 'hook.yaml'), HOOK_LIFECYCLE_EVENTS, 'hook.yaml', 'on');
  } catch (err) {
    return { ok: false, status: 400, error: sanitizeError(err) };
  }
  const matcher = optString(doc, 'matcher');

  // W8-B6 — the SAME trigger-coherence predicate lintHookDefinitions,
  // POST /api/studio/hooks and PUT /api/studio/hooks/:id use. This is the
  // FOURTH write path into studio/hooks/, and it exists precisely because a
  // creation agent — not a human filling in a form — authored these bytes; a
  // model is at least as likely to emit a matcher on SessionEnd as an
  // operator is. Gating three of four would be the one-of-N shape. Checked
  // BEFORE any filesystem write, exactly like the forbidden-key rejection above.
  const triggerError = hookTriggerError(on, matcher);
  if (triggerError) {
    return { ok: false, status: 400, error: `drafted hook.yaml: ${triggerError}` };
  }

  const permissions = parseFinalizeHookPermissions(doc['permissions']);
  if ('error' in permissions) {
    return { ok: false, status: 400, error: permissions.error };
  }

  // "scripts/run.sh must still be present" — kept as its own named check:
  // `enumerateLandedHookFiles` already proved it was READABLE if present,
  // this proves it was staged at all.
  const hasRunScript = landedFiles.some((f) => f.relParts.join('/') === 'scripts/run.sh');
  if (!hasRunScript) {
    return { ok: false, status: 400, error: `drafted scripts/run.sh is missing from the landed package "${id}"` };
  }

  // Layer 1 — SHAPE: `hookDir` runs `assertSkillSlug` (charset only).
  try {
    hookDir(id, forgeRoot);
  } catch (err) {
    return { ok: false, status: 400, error: sanitizeError(err) };
  }

  // Layer 2 — CONTAINMENT / COLLISION: the SAME guarded choke point
  // POST /api/studio/hooks uses — never a fresh lexical startsWith. Checked
  // BEFORE any write (including the Phase-1 blessing pass below) so a
  // colliding id leaves the pre-existing installed hook byte-unchanged.
  const yamlGuard = resolveGuardedPath(hooksDir(forgeRoot), [id, 'hook.yaml']);
  if (!yamlGuard.ok) {
    return { ok: false, status: 400, error: 'path traversal detected' };
  }
  if (yamlGuard.exists) {
    return { ok: false, status: 409, error: `hook "${id}" already exists` };
  }

  // Step 1 fix, cont'd — `hook.yaml` is REWRITTEN below from the validated
  // fields (fixed field order, the fixed `script: 'scripts/run.sh'`), never
  // copied verbatim; every OTHER landed file — `scripts/run.sh` included,
  // plus anything else the drafting agent staged — is copied byte-for-byte.
  //
  // PHASE 1 — bless EVERY destination through the SAME `guardedFile(...,
  // 'write')` choke point `installCommunityHookPackage` uses
  // (`orchestrator/studio/community-install.ts`), mirroring that function's
  // own "bless everything, THEN write" two-phase discipline: a failure here
  // must never leave a partial hook package on disk.
  const otherFiles = landedFiles.filter((f) => f.relParts.join('/') !== 'hook.yaml');
  const blessed: { realPath: string; body: string }[] = [];
  for (const file of otherFiles) {
    const label = file.relParts.join('/');
    const realPath = guardedFile(hooksDir(forgeRoot), [id, ...file.relParts], 'write');
    if (realPath === null) {
      return {
        ok: false,
        status: 400,
        error: `landed hook package "${id}": destination for "${label}" is not contained under studio/hooks/${id}/ (traversal or symlink) — refusing to write`,
      };
    }
    blessed.push({ realPath, body: file.body });
  }

  const outDoc: Record<string, unknown> = {
    name,
    description,
    on,
    ...(matcher ? { matcher } : {}),
    // The SAME fixed relative script path POST /api/studio/hooks always
    // writes — never the drafted hook.yaml's own (unvalidated) script field.
    script: 'scripts/run.sh',
    permissions,
  };

  // PHASE 2 — every destination is blessed; materialise the bytes.
  for (const { realPath, body } of blessed) {
    mkdirSync(dirname(realPath), { recursive: true });
    writeFileSync(realPath, body, 'utf8');
  }
  mkdirSync(dirname(yamlGuard.realPath), { recursive: true });
  writeFileSync(yamlGuard.realPath, yaml.dump(outDoc), 'utf8');

  return { ok: true };
}
