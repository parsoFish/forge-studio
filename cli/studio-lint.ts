/**
 * Studio-lint — structural integrity checks on all Forge Studio definitions.
 *
 * CLI: `forge studio lint`
 *
 * Validates:
 *   1. Agent definitions  — every studio SKILL.md in skills/
 *   2. Flow definitions   — every studio/flows/<id>/flow.yaml
 *   3. Catalog            — studio/catalog.yaml
 *   4. Projects           — auto-discovered from `<projectsDir>/*` (B1; no registry file)
 *   5. KB descriptors     — brain/<name>/kb.yaml (tolerate zero; duplicates are
 *                           errors; R1-01 also cross-checks binding.ref against
 *                           registered flows/discovered projects, and enforces
 *                           exactly one binding: { kind: unique } KB once ≥1 is
 *                           loaded)
 *
 * Missing seed files (studio/ dir, catalog.yaml) are errors. Zero discovered
 * projects is NOT an error (a fresh box has none); a project dir missing its
 * `.forge/project.json` is a warn. Absent brain kb.yaml files are NOT errors
 * (project KBs live in project repos).
 *
 * Mirrors brain-lint.ts shape: pure function, typed result, no unhandled throws.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';

import {
  isStudioAgent,
  listArtifactTemplates,
  listDemoElements,
  listInstructionSeeds,
  loadAgentDefinition,
  loadCatalog,
  loadFlowDefinition,
  loadKbDescriptor,
  discoverProjects,
} from '../orchestrator/studio/registry.ts';
import { lintTemplateLibrary } from '../orchestrator/studio/template-library.ts';
import { lintHookComposition, lintHookDefinitions } from '../orchestrator/studio/hook-library.ts';
import { lintCommunityIndex } from '../orchestrator/studio/community-index.ts';
import { validateSessionKinds } from '../orchestrator/studio/session-kinds.ts';
import {
  validateAgent,
  validateArtifactRef,
  validateArtifactTemplate,
  validateCatalog,
  validateFlow,
  validateInstructionSeed,
  validateKb,
  validateDiscoveredProjects,
  validateLibraryFlag,
  type Finding,
} from '../orchestrator/studio/validate.ts';
import { validateConnections } from '../orchestrator/studio/connection-validate.ts';
import { loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { listSkillMdDirs, skillsDir as toSkillsDir } from '../orchestrator/skill-path.ts';
import { lintSkillTrust, lintSkillRefs } from '../orchestrator/studio/skill-library.ts';
import type { AgentDefinition, KbDescriptor } from '../orchestrator/studio/types.ts';

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

  // Pre-load catalog model ids for the agent model-catalog check below. Section
  // 3 still loads + validates the catalog itself (and reports a missing file);
  // here we only need the model-id set, tolerating absence silently.
  let validModelIds: ReadonlySet<string> | undefined;
  {
    const catalogPathEarly = join(root, 'studio', 'catalog.yaml');
    if (existsSync(catalogPathEarly)) {
      try {
        validModelIds = new Set(loadCatalog(catalogPathEarly).models.map((m) => m.id));
      } catch {
        validModelIds = undefined; // section 3 surfaces the load error
      }
    }
  }

  // Pre-load catalog guard ids for the agent composition/guard-unknown check
  // below (ADR-027 R3-03 amendment) — mirrors the validModelIds block above.
  let validGuardIds: ReadonlySet<string> | undefined;
  {
    const catalogPathEarly = join(root, 'studio', 'catalog.yaml');
    if (existsSync(catalogPathEarly)) {
      try {
        validGuardIds = new Set(loadCatalog(catalogPathEarly).guards.map((g) => g.id));
      } catch {
        validGuardIds = undefined; // section 3 surfaces the load error
      }
    }
  }

  // Pre-load artifact templates (advisory typed contracts for inter-node edges).
  const artifactTemplateIds = new Set<string>();
  try {
    for (const t of listArtifactTemplates(root)) {
      findings.push(...validateArtifactTemplate(t));
      if (artifactTemplateIds.has(t.id)) {
        findings.push({
          level: 'error',
          object: `artifact-template:${t.id}`,
          check: 'unique-ids',
          message: `Duplicate artifact template id "${t.id}"`,
        });
      } else {
        artifactTemplateIds.add(t.id);
      }
    }
  } catch (err) {
    findings.push({
      level: 'error',
      object: 'studio:artifact-templates',
      check: 'load',
      message: `Cannot load artifact templates — ${(err as Error).message}`,
    });
  }

  // Demo-element library (skill-creating skills under studio/demo-elements/).
  // A malformed element file fails lint here — the loader validates required
  // frontmatter (id/name/phase/description) and throws on a violation.
  const demoElementIds = new Set<string>();
  try {
    for (const el of listDemoElements(root)) {
      if (demoElementIds.has(el.id)) {
        findings.push({
          level: 'error',
          object: `demo-element:${el.id}`,
          check: 'unique-ids',
          message: `Duplicate demo-element id "${el.id}"`,
        });
      } else {
        demoElementIds.add(el.id);
      }
    }
  } catch (err) {
    findings.push({
      level: 'error',
      object: 'studio:demo-elements',
      check: 'load',
      message: `Cannot load demo elements — ${(err as Error).message}`,
    });
  }

  // Instruction-seed library (R3-05 — composable AGENTS.md building blocks under
  // studio/instruction-seeds/). A malformed seed fails lint at load (the loader
  // validates id/title/kind/appliesTo/scope/provenance + the kind/scope enums);
  // validateInstructionSeed adds the semantic rules (slug, non-blank provenance
  // per the corpus-grounding rule, tag shape).
  const instructionSeedIds = new Set<string>();
  try {
    for (const seed of listInstructionSeeds(root)) {
      findings.push(...validateInstructionSeed(seed));
      if (instructionSeedIds.has(seed.id)) {
        findings.push({
          level: 'error',
          object: `instruction-seed:${seed.id}`,
          check: 'unique-ids',
          message: `Duplicate instruction-seed id "${seed.id}"`,
        });
      } else {
        instructionSeedIds.add(seed.id);
      }
    }
  } catch (err) {
    findings.push({
      level: 'error',
      object: 'studio:instruction-seeds',
      check: 'load',
      message: `Cannot load instruction seeds — ${(err as Error).message}`,
    });
  }

  // ------------------------------------------------------------------
  // 1. Agent definitions (skills/)
  // ------------------------------------------------------------------

  const skillsDir = toSkillsDir(root);
  const agentMap = new Map<string, AgentDefinition>();

  if (!existsSync(skillsDir)) {
    findings.push({
      level: 'error',
      object: 'studio:agents',
      check: 'load',
      message: `Required directory "${skillsDir}" is missing — skills/ must exist in a forge repo`,
    });
  } else {
    for (const dir of listSkillMdDirs(skillsDir)) {
      const entryName = basename(dir);
      const skillMdPath = join(dir, 'SKILL.md');

      // R3-01-F2: `library` must be an explicit boolean on EVERY skill dir
      // this scan reaches — not only the isStudioAgent-included ones below —
      // so a `library: false` skill is still checked to prove it's explicit.
      try {
        const raw = readFileSync(skillMdPath, 'utf8');
        const { data } = matter(raw);
        findings.push(...validateLibraryFlag(entryName, data));
      } catch (readErr) {
        findings.push({
          level: 'error',
          object: `agent:${entryName}`,
          check: 'library',
          message: `Cannot read "${skillMdPath}" to check "library" — ${(readErr as Error).message}`,
        });
      }

      let isStudio: boolean;
      try {
        isStudio = isStudioAgent(skillMdPath);
      } catch (err) {
        findings.push({
          level: 'error',
          object: `agent:${entryName}`,
          check: 'load',
          message: `Cannot check studio agent "${skillMdPath}" — ${(err as Error).message}`,
        });
        continue;
      }
      if (!isStudio) continue; // legacy skill — fine

      try {
        const def = loadAgentDefinition(skillMdPath);
        agentMap.set(def.slug, def);
        findings.push(...validateAgent(def, validModelIds, validGuardIds));
      } catch (err) {
        findings.push({
          level: 'error',
          object: `agent:${entryName}`,
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
  const flowIds = new Set<string>();
  // webhook.id → declaring flow dirs (R2-04 trigger-webhook-unique).
  const webhookIdsByFlow = new Map<string, string[]>();

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

    flowDirs.forEach((d) => flowIds.add(d));

    // Resolve a flow's project on demand (R2-04): the external-trigger project
    // requirement is checked on the TARGET flow the mint uses, not the
    // declaring flow. Lazy load — only cron/webhook targets consult it.
    const flowProjectOf = (id: string): string | null | undefined => {
      try {
        return loadFlowDefinition(join(flowsDir, id, 'flow.yaml')).project;
      } catch {
        return undefined;
      }
    };

    for (const dir of flowDirs) {
      const flowPath = join(flowsDir, dir, 'flow.yaml');
      try {
        const flow = loadFlowDefinition(flowPath);
        if (flow.id !== dir) {
          findings.push({
            level: 'error',
            object: `flow:${dir}`,
            check: 'dir-name',
            message: `flow id "${flow.id}" must match its directory name "${dir}"`,
          });
        }
        findings.push(...validateFlow(flow, agentMap, { flowIds, flowProjectOf }));
        findings.push(...validateArtifactRef(flow, artifactTemplateIds));
        for (const trigger of flow.triggers) {
          if (trigger.on === 'webhook' && trigger.webhook) {
            const claimants = webhookIdsByFlow.get(trigger.webhook.id) ?? [];
            claimants.push(dir);
            webhookIdsByFlow.set(trigger.webhook.id, claimants);
          }
        }
      } catch (err) {
        findings.push({
          level: 'error',
          object: `flow:${dir}`,
          check: 'load',
          message: `Cannot load flow.yaml — ${(err as Error).message}`,
        });
      }
    }

    // Cross-flow webhook-id uniqueness (R2-04) — validateFlow only sees one
    // flow at a time; this loop has the full roster, so the duplicate check
    // lives here instead.
    for (const [webhookId, claimants] of webhookIdsByFlow) {
      if (claimants.length > 1) {
        findings.push({
          level: 'error',
          object: 'studio:flows',
          check: 'trigger-webhook-unique',
          message: `webhook id "${webhookId}" is declared by more than one flow (${claimants.join(', ')}) — webhook ids must be unique across all flows`,
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
      object: 'studio:catalog',
      check: 'seed-present',
      message: `Required file "${catalogPath}" is missing — run the M0 seed step`,
    });
  } else {
    try {
      const catalog = loadCatalog(catalogPath);
      findings.push(...validateCatalog(catalog));
      findings.push(...validateConnections(catalog));
    } catch (err) {
      findings.push({
        level: 'error',
        object: 'studio:catalog',
        check: 'load',
        message: `Cannot load catalog.yaml — ${(err as Error).message}`,
      });
    }
  }

  // ------------------------------------------------------------------
  // 4. Projects (auto-discovered from disk — B1; no projects.yaml registry)
  //
  // Zero projects is NOT an error (a fresh box has none). We scan the projects
  // root and validate: duplicate/invalid ids error; a dir missing its
  // `.forge/project.json` contract file warns (forge will skip it).
  // ------------------------------------------------------------------

  const projectsDir = resolveProjectsDir(root, loadConfig());
  const discoveredProjects = discoverProjects(projectsDir, root);
  findings.push(...validateDiscoveredProjects(discoveredProjects));
  const projectIds = new Set(discoveredProjects.map((p) => p.id));

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
  const loadedKbs: KbDescriptor[] = [];

  for (const kbPath of kbPaths) {
    try {
      const kb = loadKbDescriptor(kbPath);
      loadedKbs.push(kb);
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

      // Dangling binding.ref (R1-01) — flow/project refs must resolve to a
      // registered flow id / discovered project id.
      if (kb.binding.kind === 'flow' && !flowIds.has(kb.binding.ref)) {
        findings.push({
          level: 'error',
          object: `kb:${kb.id}`,
          check: 'binding-ref',
          message: `KB "${kb.id}" binding.ref "${kb.binding.ref}" is not a registered flow id (studio/flows/${kb.binding.ref}/flow.yaml not found)`,
        });
      }
      if (kb.binding.kind === 'project' && !projectIds.has(kb.binding.ref)) {
        findings.push({
          level: 'error',
          object: `kb:${kb.id}`,
          check: 'binding-ref',
          message: `KB "${kb.id}" binding.ref "${kb.binding.ref}" is not a discovered project id`,
        });
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

  // Exactly one KB must declare binding: { kind: unique } (the forge-dev KB) —
  // skipped when zero KBs loaded (absent kb.yaml is not an error, see header).
  if (loadedKbs.length > 0) {
    const uniqueKbs = loadedKbs.filter((kb) => kb.binding.kind === 'unique');
    if (uniqueKbs.length === 0) {
      findings.push({
        level: 'error',
        object: 'kb:none',
        check: 'unique-binding',
        message: 'Exactly one KB must declare binding: { kind: unique } (the forge-dev KB) — found 0',
      });
    } else if (uniqueKbs.length > 1) {
      for (const kb of uniqueKbs) {
        findings.push({
          level: 'error',
          object: `kb:${kb.id}`,
          check: 'unique-binding',
          message: `Exactly one KB must declare binding: { kind: unique } — found ${uniqueKbs.length} (including "${kb.id}")`,
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // 6. Skill-library trust pipeline (R3-01-F3/F4) — a draft/needs-review skill
  //    still composed by an agent, or a needs-review skill sitting in the
  //    library at all, is a lint error; so is an agent composing a skill id
  //    that resolves to neither a local skill dir nor a catalog community
  //    entry. See orchestrator/studio/skill-library.ts (single source).
  // ------------------------------------------------------------------

  findings.push(...lintSkillTrust(root));
  findings.push(...lintSkillRefs(root));

  // ------------------------------------------------------------------
  // 7. Template library (R3-06) — union registry over artifact-templates/,
  //    demo-elements/, and starters/projects/. Mirrors the load-error idiom
  //    used throughout this file: a throw is caught and surfaced as a loud,
  //    attributed `load` error finding, never silently swallowed.
  // ------------------------------------------------------------------

  try {
    findings.push(...lintTemplateLibrary(root));
  } catch (err) {
    findings.push({
      level: 'error',
      object: 'studio:template-library',
      check: 'load',
      message: `Cannot lint template library — ${(err as Error).message}`,
    });
  }

  // ------------------------------------------------------------------
  // 8. Hooks library (R3-03) — hook.yaml load errors (bad `on`, traversal,
  //    forbidden binding key, ...) and the SYMMETRIC composition.hooks vs
  //    composition.guards enforcement. See orchestrator/studio/hook-library.ts.
  // ------------------------------------------------------------------

  findings.push(...lintHookDefinitions(root));
  findings.push(...lintHookComposition(root));

  // ------------------------------------------------------------------
  // 9. Community index (R3-07) — a vendored community skill package id must
  //    never collide with a studio/catalog.yaml community-skills id. See
  //    orchestrator/studio/community-index.ts.
  // ------------------------------------------------------------------

  findings.push(...lintCommunityIndex(root));

  // ------------------------------------------------------------------
  // 10. Session-kind registry (R2-10) — studio/session-kinds.yaml. Mirrors
  //     the load-error idiom used throughout this file: a throw is caught
  //     and surfaced as a loud, attributed `load` error finding, never
  //     silently swallowed. validateSessionKinds already turns its own load
  //     failure into a `session-kinds/load-error` Finding rather than
  //     throwing, but this try/catch stays as the same defensive shape every
  //     other section below it uses, so a future change to that contract
  //     can never silently crash the whole lint run.
  // ------------------------------------------------------------------

  try {
    findings.push(...validateSessionKinds(root));
  } catch (err) {
    findings.push({
      level: 'error',
      object: 'studio:session-kinds',
      check: 'load',
      message: `Cannot validate session kinds — ${(err as Error).message}`,
    });
  }

  // ------------------------------------------------------------------
  // Tally
  // ------------------------------------------------------------------

  const errorCount = findings.filter((f) => f.level === 'error').length;
  const flagCount = findings.filter((f) => f.level === 'flag').length;

  return { findings, errorCount, flagCount };
}
