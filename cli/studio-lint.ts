/**
 * Studio-lint — structural integrity checks on all Forge Studio definitions.
 *
 * CLI: `forge studio lint`
 *
 * Validates:
 *   1. Agent definitions  — every studio SKILL.md in skills/
 *   2. Flow definitions   — every studio/flows/<id>/flow.yaml
 *   3. Catalog            — studio/catalog.yaml
 *   4. Projects registry  — studio/projects.yaml
 *   5. KB descriptors     — brain/<name>/kb.yaml (tolerate zero; duplicates are errors)
 *
 * Missing seed files (studio/ dir, catalog.yaml, projects.yaml) are errors.
 * Absent brain kb.yaml files are NOT errors (project KBs live in project repos).
 *
 * Mirrors brain-lint.ts shape: pure function, typed result, no unhandled throws.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  isStudioAgent,
  loadAgentDefinition,
  loadCatalog,
  loadFlowDefinition,
  loadKbDescriptor,
  loadProjectsRegistry,
} from '../orchestrator/studio/registry.ts';
import {
  validateAgent,
  validateCatalog,
  validateFlow,
  validateKb,
  validateProjectsRegistry,
  type Finding,
} from '../orchestrator/studio/validate.ts';
import type { AgentDefinition } from '../orchestrator/studio/types.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { Finding };

export type StudioLintResult = {
  findings: Finding[];
  errorCount: number;
  flagCount: number;
};

export function runStudioLint(root: string): StudioLintResult {
  const findings: Finding[] = [];

  // ------------------------------------------------------------------
  // 1. Agent definitions (skills/)
  // ------------------------------------------------------------------

  const skillsDir = join(root, 'skills');
  const agentMap = new Map<string, AgentDefinition>();

  if (!existsSync(skillsDir)) {
    findings.push({
      level: 'error',
      object: 'agents',
      check: 'load',
      message: `Required directory "${skillsDir}" is missing — skills/ must exist in a forge repo`,
    });
  } else {
    let skillEntries: import('node:fs').Dirent[];
    try {
      skillEntries = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch (err) {
      skillEntries = [];
      findings.push({
        level: 'error',
        object: 'agents',
        check: 'load',
        message: `Cannot read skills directory "${skillsDir}" — ${(err as Error).message}`,
      });
    }

    for (const entry of skillEntries) {
      const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
      let isStudio: boolean;
      try {
        isStudio = isStudioAgent(skillMdPath);
      } catch (err) {
        findings.push({
          level: 'error',
          object: `agent:${entry.name}`,
          check: 'load',
          message: `Cannot check studio agent "${skillMdPath}" — ${(err as Error).message}`,
        });
        continue;
      }
      if (!isStudio) continue; // legacy skill — fine

      try {
        const def = loadAgentDefinition(skillMdPath);
        agentMap.set(def.slug, def);
        findings.push(...validateAgent(def));
      } catch (err) {
        findings.push({
          level: 'error',
          object: `agent:${entry.name}`,
          check: 'load',
          message: (err as Error).message,
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // 2. Flow definitions (studio/flows/*/flow.yaml)
  // ------------------------------------------------------------------

  const flowsDir = join(root, 'studio', 'flows');

  if (!existsSync(flowsDir)) {
    findings.push({
      level: 'error',
      object: 'studio:flows',
      check: 'seed-present',
      message: `Required directory "${flowsDir}" is missing — run the M0 seed step`,
    });
  } else {
    let flowDirs: string[];
    try {
      flowDirs = readdirSync(flowsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch (err) {
      flowDirs = [];
      findings.push({
        level: 'error',
        object: 'studio:flows',
        check: 'seed-present',
        message: `Cannot read flows directory "${flowsDir}" — ${(err as Error).message}`,
      });
    }

    if (flowDirs.length === 0) {
      findings.push({
        level: 'error',
        object: 'studio:flows',
        check: 'seed-present',
        message: `No flow definitions found in "${flowsDir}" — at least one flow is required`,
      });
    }

    for (const dir of flowDirs) {
      const flowPath = join(flowsDir, dir, 'flow.yaml');
      try {
        const flow = loadFlowDefinition(flowPath);
        findings.push(...validateFlow(flow, agentMap));
      } catch (err) {
        findings.push({
          level: 'error',
          object: `flow:${dir}`,
          check: 'load',
          message: `Cannot load flow.yaml — ${(err as Error).message}`,
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // 3. Catalog (studio/catalog.yaml)
  // ------------------------------------------------------------------

  const catalogPath = join(root, 'studio', 'catalog.yaml');

  if (!existsSync(catalogPath)) {
    findings.push({
      level: 'error',
      object: 'catalog',
      check: 'seed-present',
      message: `Required file "${catalogPath}" is missing — run the M0 seed step`,
    });
  } else {
    try {
      const catalog = loadCatalog(catalogPath);
      findings.push(...validateCatalog(catalog));
    } catch (err) {
      findings.push({
        level: 'error',
        object: 'catalog',
        check: 'load',
        message: `Cannot load catalog.yaml — ${(err as Error).message}`,
      });
    }
  }

  // ------------------------------------------------------------------
  // 4. Projects registry (studio/projects.yaml)
  // ------------------------------------------------------------------

  const projectsPath = join(root, 'studio', 'projects.yaml');

  if (!existsSync(projectsPath)) {
    findings.push({
      level: 'error',
      object: 'projects',
      check: 'seed-present',
      message: `Required file "${projectsPath}" is missing — run the M0 seed step`,
    });
  } else {
    try {
      const registry = loadProjectsRegistry(projectsPath);
      findings.push(...validateProjectsRegistry(registry));
    } catch (err) {
      findings.push({
        level: 'error',
        object: 'projects',
        check: 'load',
        message: `Cannot load projects.yaml — ${(err as Error).message}`,
      });
    }
  }

  // ------------------------------------------------------------------
  // 5. KB descriptors (brain/*/kb.yaml — absent = NOT an error)
  // ------------------------------------------------------------------

  const brainDir = join(root, 'brain');
  const kbPaths: string[] = [];

  if (existsSync(brainDir)) {
    try {
      const brainEntries = readdirSync(brainDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      for (const entry of brainEntries) {
        const candidate = join(brainDir, entry, 'kb.yaml');
        if (existsSync(candidate)) {
          kbPaths.push(candidate);
        }
      }
    } catch {
      // brain/ unreadable — tolerate silently (not part of the M0 gate)
    }
  }

  const seenKbIds = new Map<string, string>(); // id → first file path

  for (const kbPath of kbPaths) {
    try {
      const kb = loadKbDescriptor(kbPath);
      findings.push(...validateKb(kb));

      if (seenKbIds.has(kb.id)) {
        findings.push({
          level: 'error',
          object: `kb:${kb.id}`,
          check: 'unique-ids',
          message: `Duplicate KB id "${kb.id}" — also declared in "${seenKbIds.get(kb.id)}"`,
        });
      } else {
        seenKbIds.set(kb.id, kbPath);
      }
    } catch (err) {
      findings.push({
        level: 'error',
        object: 'kb:unknown',
        check: 'load',
        message: `Cannot load KB descriptor "${kbPath}" — ${(err as Error).message}`,
      });
    }
  }

  // ------------------------------------------------------------------
  // Tally
  // ------------------------------------------------------------------

  const errorCount = findings.filter((f) => f.level === 'error').length;
  const flagCount = findings.filter((f) => f.level === 'flag').length;

  return { findings, errorCount, flagCount };
}
