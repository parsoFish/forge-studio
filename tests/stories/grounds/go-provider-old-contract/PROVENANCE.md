# Fixture ground `go-provider-old-contract`

**Shape.** A Go/Terraform-provider slice carrying only the ONE package the declared quality gate
exercises, `azuredevops/internal/service/servicehook`, plus its full transitive Go dependency closure
(module-local packages and the vendored third-party SDK fork the `replace` directive in `go.mod` points
at). Built for plan D5 (M7-D, forge-1rk5.1, as amended by §12 / T1 1285, 1220 item 92, **T1 1494** and
**T1 1497**) to move S3 off a live real ground onto a forge-owned fixture. **It still does not serve S3**
— see "T1 1497" and the PROOF section below for why, and STOP below for the open decision this leaves.

**Source.** `parsoFish/terraform-provider-betterado` at **`3b2e2ca4aa53cdb24ffd6760c8476c305a62ef73`**
(T1 1494's pin — `c1a8fbca`'s first parent, i.e. betterado's real state immediately before forge's
"Rebuild contract" commits `15a74d8a`/`7432ce78` landed in PR #72) — read-only via
`git -C <real ground> archive 3b2e2ca4 | tar -x -C <tmp>`, tracked files only.

## Why not `c1a8fbca` (the prior pin) — both drift reports, side by side

The previous pass seeded from `c1a8fbca` and measured (`computeContractDrift`, `appType: 'cli'`):
every row `action: 'unchanged'`/`'preserve'`, `skillMoves: []` — pressing "Rebuild contract" writes
NOTHING, because `c1a8fbca` **is** the merge that already relocated the nine skills to
`.forge/skills/<id>/` and committed a fresh `.forge/project.json`. S3's premise (a project drifted
*from* the contract) cannot be told at that pin.

T1 1494 ruled the seed move to `3b2e2ca4` — the commit immediately before that relocation — reasoning
that the project's real, pre-rebuild state is what S3 needs. Measured this session, against a seed built
the same way (GATE-closure carry, `computeContractDrift(seed, { appType: 'cli' })`):

```
testProcess.local        action=unchanged
testProcess.ci            action=unchanged
testProcess.acceptance    action=unchanged
standing_work_item_acs    action=unchanged
demoProcess                action=add
releaseProcess             action=unchanged
buildProcess                action=unchanged
skills                      action=unchanged
skillMoves: []
gitignoreDrift.action: unchanged
commandAdvisories: [
  { section: 'testProcess.local', message: 'skipped: testProcess.local — "npm test" does not resolve (no package.json …)' },
  { section: 'testProcess.ci',    message: 'skipped: testProcess.ci — "npm run ci" does not resolve (no package.json …)' },
]
```

**Still `skillMoves: []` — for a different reason than at `c1a8fbca`.** At `3b2e2ca4`,
`.forge/project.json` **does not exist in the tracked tree at all** (`git show
3b2e2ca4:.forge/project.json` → `fatal: … exists on disk, but not in '3b2e2ca4'`; `.forge/` carries only
`quality_gate_cmd`). This is not an intentional contract state — it is an accidental drop: a merge conflict
in `e04638bc` ("Merge pull request #46 … migrate-framework-git", Jul 3) deleted the tracked
`.forge/project.json` (103 lines removed, untouched by the merge's stated intent) eight first-parent
commits before `3b2e2ca4` (Jul 11); no commit ever restored it before PR #72 built a brand-new one from
the current template (`7432ce78`, Sep 25). Confirmed via `git rev-list --first-parent` bisection: present
at `1ad7f7ae`, absent from `e04638bc` onward through `3b2e2ca4`.

`computeSkillsDrift` (`packages/projects/reset.ts`) reads `config?.skills` / `config?.artifactRoot` —
fields that only exist if `.forge/project.json` parses. `loadProjectConfig` returns `null` the instant
`guardedReadFile` can't find that file, **before** it ever reads the `.forge/quality_gate_cmd` sidecar
(`packages/projects/project-config.ts:109-110`) — so the sidecar's real GATE command is never surfaced
into `config`, either. With `config === null`: `computeSkillsDrift`'s `ids = config?.skills ?? []` is
`[]`, so it probes nothing and reports zero moves, not because the resolver looked at
`forge/skills/<id>/` and found it already fine (`c1a8fbca`'s reason) but because there is no declared
skill list to check *at all*. Independently confirmed via `apps/studio/lib/project-skills-bind.ts`'s
`offeredSkills`/`resolveSkillBinding`: the picker renders one chip per **bound** id from
`config.skills`; with no config, zero ids are bound, so beat 3 ("count: 9") and beat 4/6 (per-skill
`resolved`/`skill-source`) have no element to assert against, independent of the drift report.
`packages/projects/tests/integration/reset-drift-report.test.ts`'s own fixture confirms the mechanism's
input requirement: its `driftedProjectTree()` helper hand-writes a `.forge/project.json` declaring
`skills: […]` + `artifactRoot: 'forge'` *before* calling `computeContractDrift` — there is no path through
this code that discovers skill bindings without that declaration.

Net: `3b2e2ca4`, carried literally, replaces one blocker ("already fixed, nothing to show") with another
("nothing was ever declared to have drifted") — smaller and differently-shaped than the nine removals
S3's `expectedChanges` name, not equal to them.

## T1 1497 (option a) — restoring `.forge/project.json`

T1 ruled option (a): keep the `3b2e2ca4` tracked-tree seed exactly as measured above, and add ONE file —
`.forge/project.json`, copied VERBATIM from `e04638bc^` (`1ad7f7ae`, the last commit that carried it
tracked, per the bisection above) — plus `.forge/quality_gate_cmd` from the same commit only if it were
absent from the seed (it is not: the seed's copy, carried from `3b2e2ca4` itself, is byte-identical to
`1ad7f7ae`'s — verified with `git -C <real ground> diff 1ad7f7ae 3b2e2ca4 -- .forge/quality_gate_cmd`, no
output). Nothing else changes.

**Deviation.** Restores the ignored-untracked contract file the live ground carried, from its last
tracked version (`e04638bc^`), because a tracked-files archive cannot carry an ignored file.

**Evidence.**
- `.gitignore` at `3b2e2ca4`, line 12: `.forge/` — the whole directory is ignored (the two lines above it,
  in the source repo's own comment, explain why: `.forge/project.json` and `.forge/quality_gate_cmd` are
  meant to be force-tracked with `git add -f` so they survive this ignore; `project.json`'s force-tracked
  copy is exactly what `e04638bc` dropped — see below).
- `git -C <real ground> show e04638bc:.forge/project.json` → `fatal: path '.forge/project.json' exists on
  disk, but not in 'e04638bc'`; `git -C <real ground> show e04638bc^:.forge/project.json` (`1ad7f7ae`)
  returns the 103-line pre-migration config in full. The last TRACKED copy is at `e04638bc^`; every commit
  from `e04638bc` through `3b2e2ca4` carries it only as an ignored, on-disk (untracked) file, invisible to
  `git archive` — the mechanism this whole fixture-ground pipeline reads through.
- `git -C <real ground> show 15a74d8a -- .gitignore` (PR #72, "forge-studio: reset .gitignore (untrap
  tracked contract config)"): narrows line 12 from `.forge/` to `.forge/work-items/` +
  `.forge/.create-complete`, which is what let `7432ce78`'s fresh `project.json` land tracked again. This
  is the commit T1 1494's pin (`3b2e2ca4`) sits immediately before.
- Copied byte-for-byte: `git -C <real ground> show e04638bc^:.forge/project.json` piped straight to the
  seed path, no re-serialisation. `wc -c` on both sides: 11570 bytes, identical.

**A load-bearing fact this restores, not invents.** `1ad7f7ae`'s `.forge/project.json` is written in the
project's OLD, pre-`R1-03` flat-key schema (`ci_gate`, `ci_fix_cmd`, `ci_gate_unset_env`,
`acceptance_gate` at the top level — no `testProcess` object at all). That is the file exactly as the
project carried it when forge managed it under that schema; nothing about its shape was normalised or
updated to match the CURRENT (`R1-03`-migrated) config format. What that collision does to the PROOF step
is measured below.

**Files.** 125 files (124 + the restored `project.json`), method-C digest of `seed/`: **`5d59188fe5785cf1`**
(pipeline: `find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -print0 | sort -z | xargs -0
sha256sum`, then `sha256` over that text stream, first 16 hex chars — `scripts/stories/ground-hash.mjs`'s
own `METHOD_C_CMD`, run verbatim). Superseding count/digest below; the file breakdown that follows is
otherwise unchanged from the prior pass except for this one addition. NOT a whole-tree copy (the
source repo has hundreds of Go files across the whole provider, plus docs/examples/history) — this seed
carries:

- `.forge/quality_gate_cmd` (from `3b2e2ca4` itself, byte-identical to `e04638bc^`'s copy) plus
  `.forge/project.json` (restored from `e04638bc^` under T1 1497, above — absent from `3b2e2ca4`'s own
  tracked tree) — 2 files.
- `forge/skills/<id>/SKILL.md` for the nine ids — the skills' REAL location at this pin (the SDKv2-era
  `artifactRoot: 'forge'` layout) — 9 files.
- `AGENTS.md`, `README.md`, `go.mod`, `go.sum`, `main.go` at the repo root — 5 files. Byte-identical to
  the `c1a8fbca` copies (verified: PR #72's WHOLE diff from `3b2e2ca4` touches only `.forge/project.json`
  [new], the nine `forge/skills/*` → `.forge/skills/*` renames, and `.gitignore` — nothing else in the
  tree changed between the two pins).
- Every module-local Go package the GATE's own transitive closure needs, carried WHOLE (production and
  `_test.go` files together) — 10 directories, 21 files: `azuredevops/utils`,
  `azuredevops/utils/sdk/{dashboardextras,organization,pipelineschecksextras,securityroles}`, `version`,
  `azuredevops/internal/client`, `azuredevops/internal/utils`, `azuredevops/internal/utils/converter`,
  `azuredevops/internal/service/servicehook`. Byte-identical to the `c1a8fbca` copies (same reason).
- The vendored `third_party/azure-devops-go-api/azuredevops/v7` SDK fork's transitive subset — 40 of its
  72 subpackages plus 16 root-level files and `LICENSE` — 88 files. Byte-identical to the `c1a8fbca`
  copies.

Re-derived (not assumed) with, offline against the existing module cache (`go 1.25.8` pinned in `go.mod`,
newer than the ambient `go1.24.1`, so `GOTOOLCHAIN=auto` picks the already-cached toolchain):

```
git -C <real ground> archive 3b2e2ca4 | tar -x -C <tmp>/extracted
cd <tmp>/extracted
GOFLAGS=-mod=mod GOPROXY=off GOTOOLCHAIN=auto go list -deps -test -tags all \
  ./azuredevops/internal/service/servicehook/...
```

— 360 lines of closure, 12 module-local entries (10 unique directories after de-duplicating `.test`
variants) and 41 vendored entries (40 subpackages + the module root), diffed against the `c1a8fbca` seed's
own package set and found IDENTICAL (`diff -rq` on every carried directory: no output). This confirms PR
#72 never touched Go code — only `.forge/project.json`, the nine skill-directory renames, and
`.gitignore` — so reusing the already-verified file contents (re-extracted fresh from `3b2e2ca4` rather
than copied from the old seed, for a clean chain of custody) was safe.

**Deviations from the source.**

- **CLAUDE.md does not exist in this repo — carried `AGENTS.md` instead.** Unchanged reasoning from the
  prior PROVENANCE: this project's own conventions file is `AGENTS.md` (also S3's own
  `'contract-conventions-source': 'AGENTS.md'`).
- **A GATE-closure subset, not a whole-tree copy.** Same reasoning as before — everything reachable from
  `go list -deps -test -tags all ./azuredevops/internal/service/servicehook/...` is carried whole and
  byte-identical; everything else (other ADO resources, docs, examples, `.github/`, `.devcontainer/`, the
  32 unused vendored-SDK subpackages, `forge/history/`) is not reachable and would not change whether the
  GATE passes.
- **`main.go` is carried but its own package is not buildable in this seed** — same reasoning as before
  (it imports the top-level `azuredevops` registration package, outside the GATE's closure); the declared
  GATE never touches `package main`.
- **`.forge/project.json` restores the ignored-untracked contract file the live ground carried, from its
  last tracked version (`e04638bc^`), because a tracked-files archive cannot carry an ignored file.** See
  "T1 1497" above for the full evidence chain (the `.gitignore` line, the dropping merge, the un-ignoring
  PR). The ONE named deviation this session adds; every other line in this list is carried unchanged from
  the prior pass.
- **Skills carried at `forge/skills/<id>/`, not `.forge/skills/<id>/`** — this pin's real, pre-rebuild
  location (`artifactRoot: 'forge'`, the layout the project was onboarded under before the `.forge/`
  convention existed). Confirmed against the real ground's tree at this exact commit
  (`git -C <real ground> ls-tree -r --name-only 3b2e2ca4 -- forge`), not invented.

**Quality gate, checked before freezing.** `GATE = 'go test -tags all -count=1
./azuredevops/internal/service/servicehook/...'` (`.forge/quality_gate_cmd`, verbatim — the file exists at
this pin even though nothing in `.forge/project.json` points at it). Run inside a fresh copy of `seed/`
with `GOPROXY=off` (both with and without `GOFLAGS=-mod=mod`; `GOTOOLCHAIN=auto` resolves the pinned
`go1.25.8` from the already-populated module cache, no network reached): `ok
github.com/parsoFish/terraform-provider-betterado/azuredevops/internal/service/servicehook 0.004s`,
exit 0. `go vet -tags all` on the same target: clean, exit 0. The seed is a green ground.

**Traits carried, and the learning each encodes.**

- **The project's tracked contract was entirely absent at `3b2e2ca4` itself — an accidental drop, not the
  drift S3 asserts.** See "Why not `c1a8fbca`" for the full derivation of why that is (`e04638bc`'s merge
  conflict). T1 1497 restores the last tracked copy (`e04638bc^`) as a disclosed deviation rather than
  leaving the gap; see "T1 1497" above and the PROOF section below for what restoring it does and does not
  fix.
- **A candidate earlier pin exists that DOES show the real drift, but needs its own re-derivation.**
  `1ad7f7ae` (the last first-parent commit before the `e04638bc` merge dropped `project.json`) carries
  `.forge/project.json` with `artifactRoot: "forge"` and `skills: [` the same nine ids `]` — the actual
  pre-rebuild declaration. NOT adopted this session: `git diff --stat 1ad7f7ae 3b2e2ca4 -- azuredevops/internal/service/servicehook …`
  shows the servicehook package was substantially rewritten in between (an SDKv2 → plugin-framework
  migration — old `commons.go`/`tfs_publisher.go`/`pipelines_publisher.go` removed, new
  `*_framework.go` files added, plus a `go.mod`/`go.sum` bump), so `1ad7f7ae`'s GATE closure is a
  DIFFERENT, not-yet-derived file set from the one this seed carries. Sizing and freezing it is follow-up
  work, not something to fold into this measurement silently.
- A `go.mod` `replace` directive pointing at an in-tree vendored SDK fork
  (`third_party/azure-devops-go-api/azuredevops/v7`) rather than a registry module — the shape that made
  this fixture's closure ~4x the size of its own provider-local package count, and the reason
  `go list -deps` (not a guess) was needed to size it.
- Provisioned as its own git repository (the harness runs `git init` on the copy), the same rule every
  other fixture in this directory carries.

## PROOF — `computeContractDrift` on the T1 1497 seed

Run exactly as the brief requires, against the finished seed (`.forge/project.json` restored,
`.forge/quality_gate_cmd` unchanged):

```
node --experimental-strip-types measure-drift.mjs   # imports computeContractDrift from packages/projects/reset.ts
computeContractDrift('.../seed', { appType: 'cli' })
```

Result — it does not return a report at all. It THROWS, before any row is computed:

```
Error: project-config: conflicting flat gate key(s) alongside testProcess — remove:
  ci_gate → testProcess.ci.cmd; ci_fix_cmd → testProcess.ci.fixCmd;
  ci_gate_unset_env → testProcess.ci.unsetEnv;
  acceptance_gate → testProcess.acceptance ({match, required, requiresEnv})
    at validateProjectConfig (packages/projects/project-config.ts:193)
    at loadProjectConfig (packages/projects/project-config.ts:129)
    at computeContractDrift (packages/projects/reset.ts:560)
```

**Mechanism, traced in `packages/projects/project-config.ts`/`project-config-sidecar.ts`, not guessed.**
`loadProjectConfig` (line 109) parses the restored `project.json` (`obj.testProcess === undefined` — the
file predates the `R1-03` schema migration, all top-level: `ci_gate`, `ci_fix_cmd`, `ci_gate_unset_env`,
`acceptance_gate`), then — because `.forge/quality_gate_cmd` exists in this same seed — calls
`injectSidecarIntoTestProcess(parsed, sidecar)` (`project-config-sidecar.ts:53`). That function finds
`obj.testProcess` undefined and `local.cmd` "missing", so it SETS `obj.testProcess = { local: { cmd: […] }
}` on the parsed object, in place, before validation ever runs. `validateProjectConfig`
(`project-config.ts:169-193`) then finds the old flat keys (`ci_gate` et al.) present **alongside** the
now-defined `testProcess` the sidecar injection just created, and throws the "conflicting" branch — the
OTHER branch of the same check ("migrate", not "conflicting") is the one that would have fired had the
sidecar not intervened; either way the config never validates and no drift row is ever built.

This is deterministic and independent of `appType`: `loadProjectConfig` is called at `reset.ts:560`,
before `resolveAppType` is even reached. Two real, unmodified pieces of provenance — the old-schema
`project.json` restored under T1 1497 and the `quality_gate_cmd` sidecar the `3b2e2ca4` seed already
carried — collide under the CURRENT product's config loader, which did not exist in this shape when either
file was written.

**Verdict against the fence in the brief.** Not "exactly the nine skill moves" — not any report at all.
Per the brief ("If it is not exactly those nine moves … STOP and report — do not re-point"): this is a
harder miss than either prior measurement (`c1a8fbca`'s `skillMoves: []` on an unchanged config, or the
bare-`3b2e2ca4` `skillMoves: []` on a null config) — the CALL ITSELF cannot complete on this seed. No
`expectedChanges` widening is possible or attempted; there is no drift report to widen against.

## STOP — S3 is NOT re-pointed

Three measurements now, three different failure shapes, none matching S3's nine removals:
`c1a8fbca` → `skillMoves: []` (already fixed); bare `3b2e2ca4` → `skillMoves: []` (nothing declared,
`config === null`); `3b2e2ca4` + T1 1497's restored `project.json` → `computeContractDrift` THROWS
(old-schema config collides with the sidecar injection the CURRENT loader performs). `.forge/project.json`
was restored exactly as ruled — verbatim, from `e04638bc^`, nothing else touched — and it still does not
produce a runnable drift report, let alone the nine skill relocations. `tests/stories/S3.story.mjs` is
UNCHANGED this session — still `ground: { project: 'terraform-provider-betterado', … }`, the real ground.

The open decision for the next planning pass is now sharper than before: restoring the historical
`project.json` verbatim cannot serve S3 while the product's config loader has moved past that file's
schema. Either (a) migrate the restored `project.json` to the current `testProcess` shape as ITS OWN
disclosed deviation (no longer "verbatim" — a plan-level call, since the brief's wording for this ruling
was explicitly VERBATIM), (b) adopt `1ad7f7ae` (real, pre-drop drift, but needs a fresh GATE-closure
derivation against the rewritten servicehook package — see the "candidate earlier pin" trait above), or
(c) reconsider whether a fixture seed frozen at a single historical SHA can ever satisfy a story whose
premise depends on the CURRENT product's schema. This session does not choose among them.

**Stories served.** None yet.
