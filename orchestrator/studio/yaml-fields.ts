/**
 * Typed YAML field-extraction helpers shared by the Studio filesystem loaders
 * (registry.ts, kb-descriptor.ts). Extracted from registry.ts (R1-01) into this
 * leaf module so both the general definition loaders and the KB-descriptor
 * module draw the same strict field parsing from one place — with no import
 * cycle. Modelled on orchestrator/manifest.ts.
 */

import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

export function reqString(data: Record<string, unknown>, key: string, file: string): string {
  const v = data[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`${file}: required string field "${key}" is missing or empty`);
  }
  return v;
}

export function optString(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function reqNumber(data: Record<string, unknown>, key: string, file: string): number {
  const v = data[key];
  if (typeof v !== 'number') {
    throw new Error(`${file}: required number field "${key}" is missing or not a number`);
  }
  return v;
}

export function optNumber(data: Record<string, unknown>, key: string): number | undefined {
  const v = data[key];
  return typeof v === 'number' ? v : undefined;
}

export function optBool(data: Record<string, unknown>, key: string): boolean | undefined {
  const v = data[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function stringArray(data: Record<string, unknown>, key: string, file: string): string[] {
  const v = data[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new Error(`${file}: field "${key}" must be an array of strings`);
  }
  return (v as unknown[]).map((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`${file}: field "${key}[${i}]" must be a string`);
    }
    return item;
  });
}

export function reqObject(data: Record<string, unknown>, key: string, file: string): Record<string, unknown> {
  const v = data[key];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${file}: required object field "${key}" is missing or not an object`);
  }
  return v as Record<string, unknown>;
}

// Sentinel error class — used inside loadYaml to avoid double-wrapping.
export class RegistryError extends Error {}

export function oneOf<T extends string>(value: string, allowed: readonly T[], file: string, key: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new RegistryError(`${file}: field "${key}" must be one of ${allowed.join('|')}, got "${value}"`);
}

export function loadYaml(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`${file}: cannot read file — ${(err as Error).message}`);
  }
  try {
    const parsed = yaml.load(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RegistryError(`${file}: YAML root must be a mapping`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof RegistryError) throw err;
    throw new Error(`${file}: YAML parse error — ${(err as Error).message}`);
  }
}
