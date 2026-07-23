/**
 * KB descriptor (kb.yaml) — the KB contract type (R1-01, ADR-027 §4 amendment):
 * a strict `binding` plus an optional four-obligation `processes` block, its
 * canonical serializer, and the default-process resolver. Extracted from
 * registry.ts to keep that file under the 800-line cap; re-exported from
 * registry.ts so existing importers are unchanged.
 */

import yaml from 'js-yaml';

import { KB_BINDING_KINDS, KB_READ_SURFACES, KB_READER_ROLES } from './types.ts';
import type {
  KbBinding,
  KbDescriptor,
  KbProcessImpl,
  KbProcesses,
  KbUsagePolicy,
} from './types.ts';
import { reqString, optString, oneOf, reqObject, loadYaml } from './yaml-fields.ts';

/**
 * Strict `binding` parse (R1-01) — mirrors the strict-at-load-time treatment
 * the old `scope` enum received. `kind` must be one of KB_BINDING_KINDS;
 * `flow`/`project` bindings require a non-empty string `ref`; `unique`
 * carries no `ref`.
 */
function parseKbBinding(raw: Record<string, unknown>, file: string): KbBinding {
  const kindRaw = reqString(raw, 'kind', file);
  const kind = oneOf(kindRaw, KB_BINDING_KINDS, file, 'binding.kind');
  if (kind === 'unique') return { kind: 'unique' };
  const ref = reqString(raw, 'ref', file);
  return { kind, ref };
}

const KB_PROCESS_KEYS = ['lint', 'ingest', 'consolidate', 'usage'] as const;

/** Strict `{builtin: string} | {cmd: string}` parse for one process obligation. */
function parseKbProcessImpl(raw: unknown, file: string, key: string): KbProcessImpl {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: processes.${key} must be a mapping of {builtin} or {cmd}`);
  }
  const obj = raw as Record<string, unknown>;
  const hasBuiltin = typeof obj['builtin'] === 'string' && obj['builtin'].length > 0;
  const hasCmd = typeof obj['cmd'] === 'string' && obj['cmd'].length > 0;
  if (hasBuiltin === hasCmd) {
    throw new Error(`${file}: processes.${key} must be exactly one of {builtin} or {cmd}`);
  }
  return hasBuiltin ? { builtin: obj['builtin'] as string } : { cmd: obj['cmd'] as string };
}

function parseKbUsagePolicy(raw: unknown, file: string): KbUsagePolicy {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: processes.usage must be a mapping`);
  }
  const obj = raw as Record<string, unknown>;
  const readSurface = oneOf(reqString(obj, 'readSurface', file), KB_READ_SURFACES, file, 'processes.usage.readSurface');
  const readersRaw = obj['readers'];
  if (!Array.isArray(readersRaw) || readersRaw.length === 0) {
    throw new Error(`${file}: processes.usage.readers must be a non-empty array`);
  }
  const readers = readersRaw.map((r, i) => {
    if (typeof r !== 'string') {
      throw new Error(`${file}: processes.usage.readers[${i}] must be a string`);
    }
    return oneOf(r, KB_READER_ROLES, file, `processes.usage.readers[${i}]`);
  });
  return { readSurface, readers };
}

/** Strict `processes` parse — present only if declared; when present, all four
 * obligations are required and no unknown key is tolerated. */
function parseKbProcesses(raw: unknown, file: string): KbProcesses {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: "processes" must be a mapping`);
  }
  const obj = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter((k) => !(KB_PROCESS_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length > 0) {
    throw new Error(`${file}: processes has unknown key(s) ${unknownKeys.join(', ')} — expected only ${KB_PROCESS_KEYS.join('|')}`);
  }
  return {
    lint: parseKbProcessImpl(obj['lint'], file, 'lint'),
    ingest: parseKbProcessImpl(obj['ingest'], file, 'ingest'),
    consolidate: parseKbProcessImpl(obj['consolidate'], file, 'consolidate'),
    usage: parseKbUsagePolicy(obj['usage'], file),
  };
}

export const DEFAULT_KB_LINT: KbProcessImpl = { builtin: 'forge-brain-lint' };
export const DEFAULT_KB_INGEST: KbProcessImpl = { builtin: 'reflector-ingest' };
export const DEFAULT_KB_CONSOLIDATE: KbProcessImpl = { builtin: 'brain-fix' };

export function deriveKbUsageDefaults(binding: KbBinding): KbUsagePolicy {
  if (binding.kind === 'project') {
    return { readSurface: 'navigation-index', readers: ['planner', 'reflector', 'dev-loop', 'reviewer'] };
  }
  return { readSurface: 'navigation-index', readers: ['planner', 'reflector'] };
}

export function resolveKbProcesses(kb: KbDescriptor): Required<KbProcesses> {
  const p = kb.processes;
  return {
    lint: p?.lint ?? DEFAULT_KB_LINT,
    ingest: p?.ingest ?? DEFAULT_KB_INGEST,
    consolidate: p?.consolidate ?? DEFAULT_KB_CONSOLIDATE,
    usage: p?.usage ?? deriveKbUsageDefaults(kb.binding),
  };
}

/**
 * Serialize a KB descriptor back to kb.yaml text (R1-01 amendment — kb.yaml
 * now has a canonical serializer, mirroring serializeFlowDefinition; the
 * historical "hand-edited, no serializer by design" note referenced ADR-027
 * §4 (the KB descriptor), not §5 (the Catalog, which still has no serializer).
 */
export function serializeKbDescriptor(kb: KbDescriptor): string {
  const out: Record<string, unknown> = {};
  out['id'] = kb.id;
  out['name'] = kb.name;
  out['binding'] = kb.binding.kind === 'unique'
    ? { kind: 'unique' }
    : { kind: kb.binding.kind, ref: kb.binding.ref };
  out['desc'] = kb.desc;
  if (kb.processes !== undefined) out['processes'] = kb.processes;
  if (kb.backend !== undefined) out['backend'] = kb.backend;
  return yaml.dump(out, { lineWidth: 120, quotingType: '"', forceQuotes: false });
}

export function loadKbDescriptor(kbYamlPath: string): KbDescriptor {
  const d = loadYaml(kbYamlPath);
  const binding = parseKbBinding(reqObject(d, 'binding', kbYamlPath), kbYamlPath);
  const processesRaw = d['processes'];
  const processes =
    processesRaw === undefined || processesRaw === null
      ? undefined
      : parseKbProcesses(processesRaw, kbYamlPath);
  return {
    id: reqString(d, 'id', kbYamlPath),
    name: reqString(d, 'name', kbYamlPath),
    binding,
    desc: reqString(d, 'desc', kbYamlPath),
    processes,
    backend: optString(d, 'backend'),
    path: kbYamlPath,
  };
}
