/**
 * Pre-install validation of a VENDORED hook package. Split out of
 * `bridge-studio-community.ts` (M4-library PR 4b): two call-graph leaves with
 * no shared state that both read the same vendored `hook.yaml` to fail loud
 * before an install writes anything. The banner below is the original's.
 */

import yaml from 'js-yaml';

import { reqString, stringArray, optBool, optString, oneOf } from '@forge/kernel/studio/yaml-fields.ts';
import { type PackageFile } from './studio/skill-package.ts';
import { scanHookFiles, type HookScanReport } from './studio/hook-scan.ts';
import type { HookPackageFile } from './studio/hook-package.ts';
import {
  HOOK_LIFECYCLE_EVENTS,
  hookTriggerError,
  type HookLifecycleEvent,
  type HookPermissionManifest,
} from './studio/hook-library.ts';

// ---------------------------------------------------------------------------
// Pre-install hook scan (D7) — run it on the VENDORED bytes, never the
// installed ones. Parses hook.yaml with the SAME shared low-level field
// helpers hook-library.ts's own loadHookDefinition uses (reqString/
// stringArray/optBool/loadYaml) — a narrow, generic YAML read, not a
// re-implementation of that (install-path-scoped) loader.
//
// 2026-08-28 (hostile review, PIN A/B/C's enumeration duty): this used to
// scan ONLY the one declared entry script — the same sibling-file blind spot
// hook-scan.ts's scanHookPackage fixed post-install. Left unfixed here, this
// PRE-INSTALL preview would report `clean` for a package the POST-install
// scan reports `blocked` — an operator approving on the preview would be
// approving on a lie. Now delegates to `scanHookFiles`, the SAME primitive
// `scanHookPackage` uses — one predicate, one meaning.
//
// A vendored `PackageFile` carries no executable bit (readVendoredPackage
// never stats the leaf) — every file below gets `executable: false`, making
// this preview a LOWER BOUND: a file selected only via a real `+x` bit is
// invisible here and caught only post-install. Every other selection route
// (entry path, extension, sourced-basename fixpoint) is unaffected.
// ---------------------------------------------------------------------------

export function scanVendoredHookPackage(id: string, files: readonly PackageFile[]): HookScanReport {
  const label = `studio/community/hooks/${id}/hook.yaml`;
  const yamlFile = files.find((f) => f.path === 'hook.yaml');
  if (!yamlFile) throw new Error(`${label}: no vendored hook.yaml — cannot run the pre-install scan`);

  const parsed: unknown = yaml.load(yamlFile.body);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}: YAML root must be a mapping`);
  }
  const d = parsed as Record<string, unknown>;

  const scriptRel = reqString(d, 'script', label);
  const permsRaw = d['permissions'];
  const permsObj = permsRaw !== null && typeof permsRaw === 'object' && !Array.isArray(permsRaw) ? (permsRaw as Record<string, unknown>) : {};
  const permissions: HookPermissionManifest = {
    env: stringArray(permsObj, 'env', label),
    read: stringArray(permsObj, 'read', label),
    network: optBool(permsObj, 'network') ?? false,
  };

  if (!files.some((f) => f.path === scriptRel)) {
    throw new Error(`${label}: declares script "${scriptRel}" but no such file exists in the vendored package`);
  }

  const hookFiles: HookPackageFile[] = files.map((f) => ({ path: f.path, body: f.body, executable: false }));
  return scanHookFiles(hookFiles, permissions, scriptRel);
}


// ---------------------------------------------------------------------------
// W8-B6 — trigger coherence on the FIFTH (and least-trusted) write path into
// studio/hooks/. A vendored community package is authored by a third party, so
// it is the LAST place to assume the matcher/event pair is coherent. Checked
// HERE, in the route, rather than inside `installCommunityHookPackage`, for the
// same reason `packages/library/bridge-studio-authoring.ts:80-85` gives about its own copy
// step: the install function is a generic COPY primitive and must not grow
// hook-shape awareness. Same shared predicate as the other four callers.
// ---------------------------------------------------------------------------

export function vendoredHookTriggerError(
  id: string,
  files: readonly PackageFile[],
  sanitize: (err: unknown) => string,
): string | undefined {
  const label = `studio/community/hooks/${id}/hook.yaml`;
  const yamlFile = files.find((f) => f.path === 'hook.yaml');
  if (!yamlFile) return `${label}: no vendored hook.yaml — refusing to install a hook package with no definition`;

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlFile.body);
  } catch (err) {
    return `${label}: not valid YAML — ${sanitize(err)}`;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return `${label}: YAML root must be a mapping`;
  const d = parsed as Record<string, unknown>;

  let on: HookLifecycleEvent;
  try {
    on = oneOf(reqString(d, 'on', label), HOOK_LIFECYCLE_EVENTS, label, 'on');
  } catch (err) {
    return sanitize(err);
  }
  const triggerError = hookTriggerError(on, optString(d, 'matcher'));
  return triggerError ? `${label}: ${triggerError}` : undefined;
}
