/**
 * Seeds a freshly created project's CENTRAL Brain-3 knowledge base
 * (`brain/projects/<id>/` — ADR 035) at project-creation time, so every
 * managed project starts with a valid, `forge brain lint`-clean, and
 * Studio-KB-graph-visible stub (REFINEMENT-PLAN Phase 5 §8 — "creation seeds
 * it"). Without this, a newly onboarded project has no queryable Brain 3 and
 * immediately fails the C4 preflight clause (`cli/preflight.ts`).
 *
 * Three files, all idempotent per-file (an existing file is never
 * overwritten — skipped + reported, not clobbered):
 *
 *   - `kb.yaml`        — the KB descriptor `resolveKbBrainDir` /
 *                         `loadKbDescriptor` need to surface the project in
 *                         Studio's KB graph (`orchestrator/brain-paths.ts`).
 *                         Shape copied verbatim from the existing per-project
 *                         convention (see brain/projects/{gitpulse,mdtoc}/kb.yaml).
 *   - `profile.md`     — the machine-readable architecture profile planners
 *                         query (docs/forge-project-contract.md clause C4),
 *                         including a documented (inert, HTML-escaped)
 *                         example of the ADR 037 `forge:constraint` block
 *                         convention so project authors learn it from day one
 *                         (docs/decisions/037-compiled-wi-contracts.md item 1).
 *   - `themes/README.md` — explains the reflector-owned theme-page format
 *                         (mirrors `brain/cycles/themes/README.md` one level
 *                         down); keeps the otherwise-empty `themes/` dir
 *                         git-trackable until the project's first real theme
 *                         lands.
 *
 * The richer `project-brain-builder` skill later replaces this "index-only
 * brain stub" with real, evaluated content once an operator approves a full
 * brain build — this module only guarantees the stub exists.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { projectBrainDir, projectThemesDir } from './brain-paths.ts';
import { loadKbDescriptor, serializeKbDescriptor } from './studio/registry.ts';

export type ProjectBrainSeedFile = {
  /** forge-root-relative path, forward-slash separated. */
  path: string;
  action: 'created' | 'skipped-existing';
};

export type ProjectBrainSeedResult = {
  projectId: string;
  brainDir: string;
  files: ProjectBrainSeedFile[];
};

function toRelPath(forgeRoot: string, absPath: string): string {
  return relative(forgeRoot, absPath).split(sep).join('/');
}

function buildKbYaml(projectId: string): string {
  // R1-01: binding.kind=project ref=<projectId> — the KB contract's
  // owning-project identity, replacing the old loose `scope: project` enum.
  return serializeKbDescriptor({
    id: projectId,
    name: `${projectId} (project)`,
    binding: { kind: 'project', ref: projectId },
    desc: `Per-project brain for ${projectId} — themes the reflector distils from each ${projectId} cycle (ADR 035, central forge-owned).`,
    backend: 'filesystem',
    path: '',
  });
}

function buildProfileMd(projectId: string, name: string): string {
  return `# ${name} — project brain (Brain 3 profile)

> The project's knowledge base, read by planners and reflectors through the
> \`KbBackend\` seam. Forge-owned + CENTRAL (ADR-035) at
> \`brain/projects/${projectId}/\` — NOT in the managed project's repo.
>
> This is a scaffold stub written at project-creation time (REFINEMENT-PLAN
> Phase 5 §8). Replace every TODO below with the project's real facts; the
> \`project-brain-builder\` skill can generate a first real pass once there is
> enough project history to synthesize from.

## What this project is

TODO — one paragraph: what does this project build, for whom, and why does
it exist.

## Architecture

TODO — module map / pipeline shape planners should know before designing
work items.

## Conventions

TODO — load-bearing conventions (immutability, test strategy, dependency
policy, ...) planners must encode into every work item.

## Constraint blocks (ADR 037)

\`profile.md\` and any file under \`themes/\` can carry a machine-readable
clause the wi-spec-compiler injects verbatim into every matching work item's
spec. Delimit a block with an HTML comment carrying a mandatory stable \`id:\`
and an \`applies_to:\` selector (\`all\`, or comma-joined \`wi.<field>=<glob>\` /
\`manifest.<field>=<glob>\` AND-terms — \`*\` is the only wildcard). Example,
shown HTML-escaped so this stub does not itself register as a live
constraint (see \`docs/decisions/037-compiled-wi-contracts.md\` item 1):

    &lt;!-- forge:constraint id: example-constraint applies_to: all --&gt;
    Verbatim markdown injected into every matching work item's spec.
    &lt;!-- /forge:constraint --&gt;

To declare a real constraint, un-escape the tags (\`&lt;\` → \`<\`, \`&gt;\` → \`>\`)
and give it a unique \`id\`.
`;
}

function buildThemesReadme(projectId: string): string {
  return `# ${projectId} — Brain 3 theme pages

> Theme pages are short, durable facts the reflection phase distils from
> ${projectId}'s cycles — the *navigable* layer of this project's knowledge
> base (mirrors \`brain/cycles/themes/README.md\`'s format, one level down).

## Format

\`\`\`markdown
---
title: <short title>
description: <one-line description>
category: pattern | antipattern | decision | operation | reference
keywords: [list, of, search, terms]
created_at: <ISO-8601>
updated_at: <ISO-8601>
related_themes: [other-theme-slug-1]
---

# <Title>

<1-2 paragraphs: what happened, why it matters, when it applies.>
\`\`\`

## Rules

- One theme per real cycle lesson — not a running log.
- 15-40 lines; split into sub-themes rather than growing one page.
- Slug = filename (\`kebab-case.md\`).

This directory starts empty (this file is the only placeholder) — the
reflection phase populates it after ${projectId}'s first merged cycle.
`;
}

/**
 * Idempotently seed `brain/projects/<projectId>/` with the three files
 * above. Directories are created as needed (`mkdirSync(..., {recursive:
 * true})` is itself idempotent); each file is written only if absent, so an
 * operator's or the reflector's real content is never overwritten.
 */
export function seedProjectBrain(
  forgeRoot: string,
  projectId: string,
  name: string,
): ProjectBrainSeedResult {
  const brainDir = projectBrainDir(forgeRoot, projectId);
  const themesDir = projectThemesDir(forgeRoot, projectId);
  mkdirSync(themesDir, { recursive: true });

  const files: ProjectBrainSeedFile[] = [];

  const seedFile = (absPath: string, build: () => string, verify?: (path: string) => void): void => {
    const path = toRelPath(forgeRoot, absPath);
    if (existsSync(absPath)) {
      files.push({ path, action: 'skipped-existing' });
      return;
    }
    writeFileSync(absPath, build(), 'utf8');
    if (verify) verify(absPath);
    files.push({ path, action: 'created' });
  };

  seedFile(join(brainDir, 'kb.yaml'), () => buildKbYaml(projectId), (p) => {
    // Loud, immediate self-check: fail creation rather than ship a kb.yaml
    // Studio's KB graph can't parse.
    loadKbDescriptor(p);
  });
  seedFile(join(brainDir, 'profile.md'), () => buildProfileMd(projectId, name));
  seedFile(join(themesDir, 'README.md'), () => buildThemesReadme(projectId));

  return { projectId, brainDir, files };
}
