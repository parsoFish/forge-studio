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
import { dirname, join, relative, resolve, sep } from 'node:path';

import { projectBrainDir, projectThemesDir } from './brain-paths.ts';
import { loadKbDescriptor, serializeKbDescriptor } from './studio/registry.ts';
import { resolveGuardedPath, PathGuardContainmentError } from '../cli/studio-path-guard.ts';

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

/** One of the three fixed on-disk targets `seedProjectBrain` writes. */
type BrainSeedTarget = {
  /** Path components under `brainProjectsRoot` — this target's OWN
   *  `segments[]` element for `resolveGuardedPath`, per that module's
   *  CONTRACT section (never folded into `root`). */
  segments: readonly string[];
  /** Absolute, plain-joined path — used for the symlink-following
   *  `existsSync` idempotency probe and for relPath reporting. Never used
   *  to read/write through directly (that always goes through the
   *  guard-verified `realPath`). */
  absPath: string;
};

/**
 * SINGLE SOURCE OF TRUTH for what `seedProjectBrain` writes: `projectId`'s
 * three targets (`kb.yaml`, `profile.md`, `themes/README.md`) under
 * `<forgeRoot>/brain/projects/<projectId>/`, plus the trusted containment
 * root. Both `checkProjectBrainSeedContainment` (the pure pre-check) and
 * `seedProjectBrain` itself (the write) compute their target paths from
 * THIS function and nowhere else — SEC-03 round 4's T1 ruling: a second,
 * independently-computed copy of this path set is exactly the "two layers
 * that drift apart" failure this campaign keeps closing.
 */
function brainSeedTargets(
  forgeRoot: string,
  projectId: string,
): {
  brainDir: string;
  themesDir: string;
  brainProjectsRoot: string;
  kb: BrainSeedTarget;
  profile: BrainSeedTarget;
  themesReadme: BrainSeedTarget;
} {
  const brainDir = projectBrainDir(forgeRoot, projectId);
  const themesDir = projectThemesDir(forgeRoot, projectId);
  // Fixed, config-derived containment root — never built by folding
  // `projectId` into it (studio-path-guard.ts's CONTRACT section).
  const brainProjectsRoot = resolve(forgeRoot, 'brain', 'projects');
  return {
    brainDir,
    themesDir,
    brainProjectsRoot,
    kb: { segments: [projectId, 'kb.yaml'], absPath: join(brainDir, 'kb.yaml') },
    profile: { segments: [projectId, 'profile.md'], absPath: join(brainDir, 'profile.md') },
    themesReadme: { segments: [projectId, 'themes', 'README.md'], absPath: join(themesDir, 'README.md') },
  };
}

/**
 * PURE containment pre-check (SEC-03 round 4, T1's two-phase
 * check-then-write ruling) for every path `seedProjectBrain` will write for
 * `projectId`. Zero side effects on request-derived paths: no
 * `writeFileSync`, and no `mkdirSync` beneath `brain/projects/` — the ONLY
 * filesystem mutation here is materializing `<forgeRoot>/brain/projects`
 * itself (see below), which is entirely forgeRoot + fixed literal segments,
 * never influenced by `projectId`.
 *
 * A caller uses this to validate the brain-seed targets BEFORE performing
 * ANY write on its route (including writes entirely unrelated to the
 * brain — e.g. the project-directory scaffolding on both create paths),
 * so a rejection here can never race a write that already landed
 * elsewhere. `seedProjectBrain` below calls this SAME function first, so
 * there is exactly one path set and one containment check, not two that
 * could silently diverge.
 *
 * Throws `PathGuardContainmentError` on any rejection; returns normally
 * (void) once every target is either already-existing (idempotent skip,
 * mirroring `seedProjectBrain`'s own per-file idempotency contract — see
 * its docstring) or passes `resolveGuardedPath`'s per-segment identity walk.
 */
export function checkProjectBrainSeedContainment(forgeRoot: string, projectId: string): void {
  const { brainProjectsRoot, kb, profile, themesReadme } = brainSeedTargets(forgeRoot, projectId);
  // `resolveGuardedPath` deliberately performs NO identity check on `root`
  // itself and has no create-mode for it (it must already exist) — see that
  // module's CONTRACT section. Materializing this TRUSTED, forgeRoot-derived
  // directory when absent (a brand-new forge instance's first-ever project)
  // is not a request-controlled write — nothing request-derived (no
  // `projectId` segment) is ever created by this call.
  mkdirSync(brainProjectsRoot, { recursive: true });

  for (const target of [kb, profile, themesReadme]) {
    if (existsSync(target.absPath)) continue; // already there — idempotent skip, nothing to guard
    const guard = resolveGuardedPath(brainProjectsRoot, target.segments);
    if (!guard.ok) {
      throw new PathGuardContainmentError(`seedProjectBrain: containment check failed for "${target.segments.join('/')}"`);
    }
  }
}

/**
 * Idempotently seed `brain/projects/<projectId>/` with the three files
 * above. Each file is written only if absent, so an operator's or the
 * reflector's real content is never overwritten.
 *
 * SEC-03 Finding A (round-2 adversarial review) — `projectId` is
 * `SLUG_RE`-validated by every caller (never traverses), so this was never a
 * traversing-id bug; the vector is a PRE-PLANTED symlink/hardlink under
 * `brain/projects/<projectId>/`. The old implementation resolved every path
 * with a bare `join()`/`resolve()` off a TRUSTED `forgeRoot` and NO
 * per-segment containment — including the up-front `mkdirSync(themesDir,
 * {recursive: true})`, which created directories through a symlinked
 * `<projectId>` or `<projectId>/themes` segment before any file was ever
 * written. Every write below is now resolved through the shared
 * `resolveGuardedPath` (`cli/studio-path-guard.ts`), with the FIXED
 * `brain/projects/` directory as the TRUSTED root and `projectId` (plus
 * every path component below it) as its OWN `segments[]` element — never
 * folded into `root` (see that module's CONTRACT section: folding an
 * untrusted id into `root` bypasses the per-segment identity walk
 * entirely).
 *
 * SEC-03 Finding B parity — mirrors `scaffoldContractArtifacts`: existence
 * is probed FIRST with a plain, symlink-following `existsSync` (the
 * idempotency contract's actual meaning — "already there, skip"), and the
 * containment guard is invoked ONLY for a file that is genuinely absent (a
 * dangling symlink still reads as absent here, so it still reaches the
 * guard and is still rejected). A file that already exists — including an
 * ordinary in-forgeRoot hardlink — is skipped without ever reaching
 * `resolveGuardedPath`'s `nlink` check, so it can never be false-rejected
 * for a write this function was never going to make.
 *
 * All three guards run (or the file is marked skipped) BEFORE any of the
 * writes below — same reason as `scaffoldContractArtifacts`: a guard that
 * has to unwind a write it already made is a guard in the wrong place. A
 * rejection throws `PathGuardContainmentError` rather than silently
 * skipping the write (a skipped write reported as success is the "declared
 * data fails open" shape this campaign keeps finding); the caller is
 * responsible for turning that into a generic, fail-closed 4xx before any
 * later write (e.g. `.forge/project.json`) proceeds.
 *
 * SEC-03 round 4 — calls `checkProjectBrainSeedContainment` (above) FIRST,
 * so this function's own containment behaviour and a caller's Phase-1
 * pre-check are backed by the exact same code, not a parallel
 * re-implementation. The per-file `resolveGuardedPath` call in `plan()`
 * below re-verifies (rather than blindly trusting) that pre-check before
 * ever writing through its `realPath` — this function never writes through
 * a path it has not itself just verified, whether or not a caller already
 * called the pre-check too.
 */
export function seedProjectBrain(
  forgeRoot: string,
  projectId: string,
  name: string,
): ProjectBrainSeedResult {
  checkProjectBrainSeedContainment(forgeRoot, projectId);

  const { brainDir, brainProjectsRoot, kb, profile, themesReadme } = brainSeedTargets(forgeRoot, projectId);

  const files: ProjectBrainSeedFile[] = [];
  const pending: Array<{ realPath: string; build: () => string; verify?: (path: string) => void }> = [];

  const plan = (
    target: BrainSeedTarget,
    build: () => string,
    verify?: (path: string) => void,
  ): void => {
    const path = toRelPath(forgeRoot, target.absPath);
    if (existsSync(target.absPath)) {
      files.push({ path, action: 'skipped-existing' });
      return;
    }
    const guard = resolveGuardedPath(brainProjectsRoot, target.segments);
    if (!guard.ok) {
      throw new PathGuardContainmentError(`seedProjectBrain: containment check failed for "${path}"`);
    }
    pending.push({ realPath: guard.realPath, build, verify });
  };

  plan(kb, () => buildKbYaml(projectId), (p) => {
    // Loud, immediate self-check: fail creation rather than ship a kb.yaml
    // Studio's KB graph can't parse.
    loadKbDescriptor(p);
  });
  plan(profile, () => buildProfileMd(projectId, name));
  plan(themesReadme, () => buildThemesReadme(projectId));

  // Every guard above already passed (or its file was marked skipped) —
  // perform the writes only now.
  for (const w of pending) {
    mkdirSync(dirname(w.realPath), { recursive: true });
    writeFileSync(w.realPath, w.build(), 'utf8');
    if (w.verify) w.verify(w.realPath);
    files.push({ path: toRelPath(forgeRoot, w.realPath), action: 'created' });
  }

  return { projectId, brainDir, files };
}
