/**
 * `forge studio lint`'s library-kind passes — the inline loader+validate
 * scaffolding for Artifact template / Demo element / Instruction seed /
 * Catalog / Community, split out of `apps/forge/studio-lint.ts` (M4 library-by-kind
 * carve, PR 3 / Part 2).
 *
 * MOVED VERBATIM (behaviour, order and messages unchanged) — five sections of
 * `runStudioLint` (apps/forge/studio-lint.ts, pre-carve head): the artifact-template
 * preload loop, the demo-element preload loop, the instruction-seed preload
 * loop, Catalog section §3 (including its `validateConnections` call), and
 * Community section §3b + the stray-staging check. `runStudioLint` calls
 * these five functions, in the same order, and concatenates their findings
 * into its own accumulator — it is unaware anything moved.
 *
 * The catalog model-id/guard-id preload (`runStudioLint`'s own lines 107-135
 * on the pre-carve head) STAYS in `apps/forge/studio-lint.ts` — cross-kind glue
 * feeding `validateAgent`'s checks, not Catalog-kind logic — and is not
 * duplicated here.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Finding } from '@forge/kernel';
import {
  listArtifactTemplates,
  listDemoElements,
  listInstructionSeeds,
} from './studio/artifact-registry.ts';
import { loadCatalog } from './studio/catalog-registry.ts';
import { communityRegistryPath, loadCommunityRegistry } from './studio/community-registry.ts';
import {
  validateArtifactTemplate,
  validateCatalog,
  validateCommunityRegistry,
  validateInstructionSeed,
} from './studio/library-validate.ts';
import { validateConnections } from './studio/connection-validate.ts';

// ---------------------------------------------------------------------------
// Artifact templates — pre-load (advisory typed contracts for inter-node
// edges). `artifactTemplateIds` is returned alongside `findings` because
// `runStudioLint`'s flow section (§2) needs it for `validateArtifactRef`.
// ---------------------------------------------------------------------------

export function lintArtifactTemplates(root: string): { findings: Finding[]; artifactTemplateIds: Set<string> } {
  const findings: Finding[] = [];
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
  return { findings, artifactTemplateIds };
}

// ---------------------------------------------------------------------------
// Demo-element library (skill-creating skills under studio/demo-elements/).
// A malformed element file fails lint here — the loader validates required
// frontmatter (id/name/phase/description) and throws on a violation.
// ---------------------------------------------------------------------------

export function lintDemoElements(root: string): Finding[] {
  const findings: Finding[] = [];
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
  return findings;
}

// ---------------------------------------------------------------------------
// Instruction-seed library (R3-05 — composable AGENTS.md building blocks under
// studio/instruction-seeds/). A malformed seed fails lint at load (the loader
// validates id/title/kind/appliesTo/scope/provenance + the kind/scope enums);
// validateInstructionSeed adds the semantic rules (slug, non-blank provenance
// per the corpus-grounding rule, tag shape).
// ---------------------------------------------------------------------------

export function lintInstructionSeeds(root: string): Finding[] {
  const findings: Finding[] = [];
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
  return findings;
}

// ---------------------------------------------------------------------------
// Catalog (studio/catalog.yaml)
// ---------------------------------------------------------------------------

export function lintCatalogSection(root: string): Finding[] {
  const findings: Finding[] = [];
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
  return findings;
}

// ---------------------------------------------------------------------------
// Community registry (studio/community/registry.yaml, W6-CR-1) — the
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
//
// Also covers W7-B3 (community-01 / sessions-kinds-32)'s stray-staging
// check: studio/community/staging/ was NEVER a legitimate location — it was
// the debris of the pre-fence era, when the now-retired community-refresh
// interactive session kind resolved its relative "staging/" instruction
// beside registryPath and dumped its draft into the repo. The debris is
// untracked, so it can still be sitting on an operator's disk from before
// either fix landed; this check keeps flagging it until they delete it.
// ---------------------------------------------------------------------------

export function lintCommunitySection(root: string): Finding[] {
  const findings: Finding[] = [];
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

  const strayStaging = join(root, 'studio', 'community', 'staging');
  if (existsSync(strayStaging)) {
    findings.push({
      level: 'error',
      object: 'studio:community-registry',
      check: 'community/stray-staging',
      message: `"${strayStaging}" exists — leftover debris from the pre-fence era of the now-retired community-refresh session kind (an agent draft that once escaped its session dir). Delete the directory; it has no legitimate use.`,
    });
  }
  return findings;
}
