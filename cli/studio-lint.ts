/**
 * Studio-lint — structural integrity checks on all Forge Studio definitions.
 *
 * CLI: `forge studio lint`
 *
 * Validates:
 *   1. Agent definitions  — every studio SKILL.md in skills/
 *   2. Flow definitions   — every studio/flows/<id>/flow.yaml
 *   3. Catalog            — studio/catalog.yaml
 *   3b. Community registry — studio/community/registry.yaml (W6-CR-1; MISSING
 *                           IS an error — this content was previously
 *                           mandatory inside catalog.yaml, so forge's own
 *                           repo must always ship it. Stricter than the
 *                           runtime reader: community-index.ts's
 *                           registrySource() still degrades a missing file to
 *                           [] with a console.warn, since the bridge must not
 *                           crash a live session mid-seed)
 *   4. Projects           — auto-discovered from `<projectsDir>/*` (B1; no registry file)
 *   5. KB descriptors     — brain/<name>/kb.yaml (tolerate zero; duplicates are
 *                           errors; R1-01 also cross-checks binding.ref against
 *                           registered flows/discovered projects, and enforces
 *                           exactly one binding: { kind: unique } KB once ≥1 is
 *                           loaded)
 *
 * Missing seed files (studio/ dir, catalog.yaml, studio/community/registry.yaml)
 * are errors. Zero discovered projects is NOT an error (a fresh box has none);
 * a project dir missing its `.forge/project.json` is a warn. Absent brain
 * kb.yaml files are NOT errors (project KBs live in project repos).
 *
 * Mirrors brain-lint.ts shape: pure function, typed result, no unhandled throws.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import matter from 'gray-matter';

import {
  isStudioAgent,
  listArtifactTemplates,
  listDemoElements,
  listInstructionSeeds,
  loadAgentDefinition,
  loadCatalog,
  loadCommunityRegistry,
  communityRegistryPath,
  loadFlowDefinition,
  loadKbDescriptor,
  loadStarterFlow,
  listStarterAgents,
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
  validateCommunityRegistry,
  validateFlow,
  validateInstructionSeed,
  validateKb,
  validateDiscoveredProjects,
  validateLibraryFlag,
  type Finding,
} from '../orchestrator/studio/validate.ts';
import { validateConnections } from '../orchestrator/studio/connection-validate.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { listSkillMdDirs, skillsDir as toSkillsDir } from '../orchestrator/skill-path.ts';
import { lintSkillTrust, lintSkillRefs } from '../orchestrator/studio/skill-library.ts';
import type { AgentDefinition, KbDescriptor } from '../orchestrator/studio/types.ts';
import { listFlowBandIds } from './flow-band-vocab.ts';
import { kbReadPolicyViolation } from './kb-read-policy.ts';
import { unroutableKbReason } from './kb-sites.ts';
import { lintSkillToolFence, lintStarterAgentToolFence } from './studio-lint-tool-fence.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { Finding };

export type StudioLintResult = {
  findings: Finding[];
  errorCount: number;
  flagCount: number;
};

/**
 * W7-FIX-A4 (W7A4-04): a kb.yaml whose `id` is not its directory name (or
 * fails the id rule) is dropped by the roster AND loses its derived
 * project↔KB binding with no diagnostic — this is the lint backstop for the
 * SAME predicate (`unroutableKbReason`, cli/kb-sites.ts), mirroring the flow
 * `dir-name` check above.
 */
function kbDirNameFindings(kbId: string, kbPath: string): Finding[] {
  const dir = basename(dirname(kbPath));
  const reason = unroutableKbReason(kbId, dir);
  if (reason === null) return [];
  return [{ level: 'error', object: `kb:${kbId}`, check: 'dir-name', message: reason }];
}

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
        // `{}` bypasses gray-matter's parse cache (poisoning class documented
        // in cli/theme-frontmatter.ts module header).
        const { data } = matter(raw, {});
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

  // Projects (auto-discovered from disk — B1) computed HERE, ahead of flow
  // validation below, so the `trigger-projects` check (R2-08-F1) can see the
  // SAME project enumeration the runtime dispatcher resolves against (rule 2:
  // "lint reads the same evidence the dispatcher reads"). The findings push
  // for discovered-project shape stays down in section 4, in its original
  // report position — only the computation moved earlier.
  const projectsDir = resolveProjectsDir(root, loadConfig(defaultConfigPath(root)));
  const discoveredProjects = discoverProjects(projectsDir, root);
  const projectIds = new Set(discoveredProjects.map((p) => p.id));

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
        findings.push(...validateFlow(flow, agentMap, { flowIds, flowProjectOf, projectIds }));
        findings.push(...validateArtifactRef(flow, artifactTemplateIds));
        for (const trigger of flow.triggers) {
          // R2-08-F3: `pr-merged` / `issue-raised` reuse the SAME `webhook:`
          // id namespace (POST /api/hooks/:hookId serves all three kinds) —
          // a hook id collision across kinds is exactly as unresolvable as
          // one within `on: webhook` alone (findWebhookTrigger returns only
          // the first flow it scans), so it must be caught here too.
          if (
            (trigger.on === 'webhook' || trigger.on === 'pr-merged' || trigger.on === 'issue-raised') &&
            trigger.webhook
          ) {
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
  // 3b. Community registry (studio/community/registry.yaml, W6-CR-1) — the
  //     declared-list source of truth for community items, superseding
  //     catalog.yaml's former `community-skills:` section.
  //
  //     Reviewer fix (W6-CR-1 round 2): a MISSING registry.yaml IS a lint
  //     error here (seed-present, mirrors catalog.yaml's own missing-file
  //     check immediately above) — this content was PREVIOUSLY mandatory
  //     inside catalog.yaml, so forge's own repo must always ship the file it
  //     moved to; a fresh checkout mid-seed that never runs `forge studio
  //     lint` simply hasn't finished seeding yet. This is deliberately
  //     STRICTER than the RUNTIME reader — orchestrator/studio/
  //     community-index.ts's `registrySource()` still degrades a missing file
  //     to `[]` with a console.warn, because the bridge must not crash a live
  //     session mid-seed; lint is the gate that catches "forgot to ship it"
  //     before that degrade ever has to fire in a real forge checkout. A file
  //     that EXISTS but fails to parse (missing required field, bad kind
  //     vocab, malformed signals) surfaces as a loud `load` finding, naming
  //     the real underlying error, never silently treated as an honest empty
  //     registry.
  // ------------------------------------------------------------------

  const registryPath = communityRegistryPath(root);
  if (!existsSync(registryPath)) {
    findings.push({
      level: 'error',
      object: 'studio:community-registry',
      check: 'seed-present',
      message: `Required file "${registryPath}" is missing — run the M0 seed step`,
    });
  } else {
    try {
      const registry = loadCommunityRegistry(registryPath);
      findings.push(...validateCommunityRegistry(registry));
    } catch (err) {
      findings.push({
        level: 'error',
        object: 'studio:community-registry',
        check: 'load',
        message: `Cannot load studio/community/registry.yaml — ${(err as Error).message}`,
      });
    }
  }

  // W7-B3 (community-01 / sessions-kinds-32), HISTORY (W8-B5b): studio/
  // community/staging/ was NEVER a legitimate location — it was the debris
  // of the pre-fence era, when the now-retired community-refresh
  // interactive session kind (mechanism A; superseded by the deterministic
  // `forge community refresh`, W8-B5) resolved its relative "staging/"
  // instruction beside registryPath and dumped its draft into the repo. The
  // fence (W7-A2) plus the absolute-path prompt (W7-B3) prevented new debris
  // for as long as the kind ran, and the kind itself is gone now — but the
  // debris is untracked, so it can still be sitting on an operator's disk
  // from before either fix landed. This check keeps flagging it until they
  // delete it; no code change can remove it from their checkout for them.
  const strayStaging = join(root, 'studio', 'community', 'staging');
  if (existsSync(strayStaging)) {
    findings.push({
      level: 'error',
      object: 'studio:community-registry',
      check: 'community/stray-staging',
      message: `"${strayStaging}" exists — leftover debris from the pre-fence era of the now-retired community-refresh session kind (an agent draft that once escaped its session dir). Delete the directory; it has no legitimate use.`,
    });
  }

  // ------------------------------------------------------------------
  // 4. Projects (auto-discovered from disk — B1; no projects.yaml registry)
  //
  // Zero projects is NOT an error (a fresh box has none). We scan the projects
  // root and validate: duplicate/invalid ids error; a dir missing its
  // `.forge/project.json` contract file warns (forge will skip it).
  // (`projectsDir` / `discoveredProjects` / `projectIds` are computed earlier,
  // ahead of section 2, so `trigger-projects` can consult them — see there.)
  // ------------------------------------------------------------------

  findings.push(...validateDiscoveredProjects(discoveredProjects));

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

  // Read-policy scan (R1-06, §5b below) also covers the central per-project
  // brains (brain/projects/<id>/kb.yaml, ADR 035) — the ADR-010 amendment
  // ratifies the guard walking BOTH brain/*/kb.yaml AND brain/projects/*/kb.yaml.
  // The R1-01 binding-ref / unique checks stay one-level-deep BY DESIGN (a
  // sandbox checkout may lack the projects a project binding points at, so
  // descending would fabricate dangling-ref errors); the read-policy predicate
  // exempts project bindings, so this deeper walk adds no false errors while
  // still catching a rogue flow/unique binding planted under brain/projects/.
  const projectKbPaths: string[] = [];
  const projectsBrainDir = join(brainDir, 'projects');
  if (existsSync(projectsBrainDir)) {
    try {
      for (const entry of readdirSync(projectsBrainDir, { withFileTypes: true })) {
        // Skip dot-prefixed dirs (a `.staging-*` orphan must never surface).
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const candidate = join(projectsBrainDir, entry.name, 'kb.yaml');
        if (existsSync(candidate)) projectKbPaths.push(candidate);
      }
    } catch {
      // brain/projects/ unreadable — tolerate silently (not part of the M0 gate)
    }
  }

  const seenKbIds = new Map<string, string>(); // id → first file path
  const loadedKbs: KbDescriptor[] = [];

  for (const kbPath of kbPaths) {
    try {
      const kb = loadKbDescriptor(kbPath);
      loadedKbs.push(kb);
      findings.push(...validateKb(kb));
      findings.push(...kbDirNameFindings(kb.id, kbPath));

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
      } else if (kb.binding.kind === 'flow' && kb.binding.band !== undefined) {
        // R1-06 — a declared band must be one the bound flow's own nodes
        // actually run under (flow -> node -> agent -> declared band, one
        // level deeper than the ref-existence check above). Only checked
        // once the ref itself resolves — a dangling ref already errors above
        // and has no real flow to derive a band vocabulary from.
        const realBands = listFlowBandIds(root, kb.binding.ref);
        if (!realBands.includes(kb.binding.band)) {
          findings.push({
            level: 'error',
            object: `kb:${kb.id}`,
            check: 'binding-band',
            message: `KB "${kb.id}" binding.band "${kb.binding.band}" is not one of flow "${kb.binding.ref}"'s real bands: ${realBands.join(', ')}`,
          });
        }
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
  // 5b. KB read-policy guard (R1-06, ADR-010 amendment "R1-06 band-scoped
  //     reviewer grant"). The asymmetric brain-read policy (ADR-010) forbids a
  //     `dev-loop` OR `reviewer` reader grant on any NON-project KB binding,
  //     except the ONE ratified exception: a flow binding scoped to
  //     band:'review-band' may grant the reviewer an advisory read. This applies
  //     the pure `kbReadPolicyViolation` predicate (cli/kb-read-policy.ts) to
  //     every real, loaded descriptor — the production wiring of a guard that
  //     previously ran only over tmpdir fixtures inside a test. Walks both brain
  //     shapes (top-level + brain/projects/*), per the ADR-010 amendment.
  // ------------------------------------------------------------------
  const readPolicyKbs: KbDescriptor[] = [...loadedKbs];
  for (const p of projectKbPaths) {
    try {
      const kb = loadKbDescriptor(p);
      readPolicyKbs.push(kb);
      // W7-FIX-A4 (W7A4-04): the ADR-035 root gets the SAME dir-name check —
      // a mismatched per-project brain silently loses its derived project↔KB
      // binding, which is exactly the case this backstops.
      findings.push(...kbDirNameFindings(kb.id, p));
    } catch {
      // A project kb.yaml that will not load is out of read-policy scope (a
      // project binding is exempt anyway) — no double-report of a load error.
    }
  }
  for (const kb of readPolicyKbs) {
    const verdict = kbReadPolicyViolation(kb);
    if (!verdict.ok) {
      findings.push({
        level: 'error',
        object: `kb:${kb.id}`,
        check: 'read-policy',
        message: verdict.reason,
      });
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
  // 6b. Tool-fence sweep — a roster SKILL.md that declares tool frontmatter
  //     (`allowed-tools:`/`disallowed-tools:`) must list `Task` and `Agent`
  //     in `disallowed-tools`. `allowed-tools` is advisory only (no
  //     production spawn site sets `options.tools`); `disallowed-tools` is
  //     the only field that actually removes the subagent-spawn tool from a
  //     skill's reach. Local to this file (not `orchestrator/studio/`) per
  //     ADR 042 boundary 1/4 — its only production caller is this module.
  //     Covers BOTH the installed roster (`skills/`) and the OOTB starter
  //     template tree (`studio/starters/agents/**`, ADR-033) — the latter is
  //     the SOURCE those installs are copied from, and forge-6gv.18 shipped
  //     because only the roster half was ever scanned.
  // ------------------------------------------------------------------

  findings.push(...lintSkillToolFence(root));
  findings.push(...lintStarterAgentToolFence(root));

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
  // 11. Starter flow (W7-B4, flows-09) — the seeded /flows/new canvas must
  //     be SAVEABLE by construction: every node agent in
  //     studio/starters/flows/basic.yaml must resolve in skills/ (the live
  //     roster) or studio/starters/agents/ (the closed set the flow PUT
  //     materialises on save). An agent in neither place means the very
  //     first thing a new operator draws can never be saved.
  // ------------------------------------------------------------------

  try {
    const starterFlow = loadStarterFlow(root);
    if (starterFlow) {
      const starterSlugs = new Set(listStarterAgents(root).map((a) => a.slug));
      for (const node of starterFlow.nodes) {
        if (!node.agent) continue;
        const inRoster = existsSync(join(root, 'skills', node.agent, 'SKILL.md'));
        if (!inRoster && !starterSlugs.has(node.agent)) {
          findings.push({
            level: 'error',
            object: 'starter-flow:basic',
            check: 'starter-flow/agent-unresolvable',
            message: `studio/starters/flows/basic.yaml node "${node.id}" references agent "${node.agent}", which resolves in neither skills/ nor studio/starters/agents/ — the seeded canvas could never be saved (flows-09)`,
          });
        }
      }
    }
  } catch (err) {
    findings.push({
      level: 'error',
      object: 'starter-flow:basic',
      check: 'load',
      message: `Cannot lint the starter flow — ${(err as Error).message}`,
    });
  }

  // ------------------------------------------------------------------
  // Tally
  // ------------------------------------------------------------------

  const errorCount = findings.filter((f) => f.level === 'error').length;
  const flagCount = findings.filter((f) => f.level === 'flag').length;

  return { findings, errorCount, flagCount };
}
