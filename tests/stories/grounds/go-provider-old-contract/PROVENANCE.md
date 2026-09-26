# Fixture ground `go-provider-old-contract`

**Shape.** A Go/Terraform-provider slice carrying only the ONE package the declared quality gate
exercises, `azuredevops/internal/service/servicehook`, plus its full transitive Go dependency closure
(module-local packages and the vendored third-party SDK fork the `replace` directive in `go.mod` points
at). Built for plan D5 (M7-D, forge-1rk5.1, as amended by §12 / T1 1285, 1220 item 92, **T1 1494** and
**T1 1497**) to move S3 off a live real ground onto a forge-owned fixture. `.forge/project.json` went
through two restoration attempts before this seed served S3: a July tracked copy (`e04638bc^`) that
THREW on the current config loader (kept below as evidence), then a byte-exact live-ground capture that
PROVED clean — see "T1 1497 — the live capture" and the PROOF section below.

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

## T1 1497, first attempt (option a) — the July tracked copy from `e04638bc^` (SUPERSEDED)

Kept in full below as recorded evidence for why the live capture (next section) was needed: the July
tracked copy predates the product's `testProcess` schema migration and could not be validated by the
current config loader, no matter how it was carried.

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

**Files.** 127 files, method-C digest of `seed/`: **`94e16fb026da34b0`** — the FINAL value, after
`.gitignore` and `roadmap.md` were added verbatim from `3b2e2ca4` (see "Closing the beat-10 gap" below;
supersedes `49416ee66caaf3d4`, itself superseding the first attempt's `5d59188fe5785cf1`, both recorded
below as history). Pipeline: `find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -print0 |
sort -z | xargs -0 sha256sum`, then `sha256` over that text stream, first 16 hex chars —
`scripts/stories/ground-hash.mjs`'s own `METHOD_C_CMD`, run verbatim. The file breakdown that follows is
otherwise unchanged from the prior pass except as noted. NOT a whole-tree copy (the
source repo has hundreds of Go files across the whole provider, plus docs/examples/history) — this seed
carries:

- `.gitignore` and `roadmap.md` at the repo root, both tracked at `3b2e2ca4` and carried verbatim — 2
  files. `.gitignore` is C2's own subject (its blanket `.forge/` ignore is the live ground's real,
  pre-rebuild behaviour); `roadmap.md` is C4's "machine-readable architecture context" (4822 bytes).
- `.forge/quality_gate_cmd` (from `3b2e2ca4` itself, byte-identical to `e04638bc^`'s copy) plus
  `.forge/project.json` (restored — absent from `3b2e2ca4`'s own tracked tree; FINAL content is the live
  capture, "T1 1497 — the live capture" below) — 2 files.
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
- **`.forge/project.json` restores the ignored-untracked contract file the live ground carried, from a
  byte-exact capture of the live ground's `.forge/` taken 2026-09-05 at `3b2e2ca4` when this story was
  authored, because a tracked-files archive cannot carry an ignored file.** See "T1 1497 — the live
  capture" below for the full evidence chain (the `.gitignore` line, the dropping merge, the un-ignoring
  PR, the capture itself). The ONE named deviation this session adds; every other line in this list is
  carried unchanged from the prior pass.
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

## PROOF, first attempt — `computeContractDrift` throws on the July copy (SUPERSEDED)

Run exactly as the brief requires, against the first-attempt seed (`.forge/project.json` restored from
`e04638bc^`, `.forge/quality_gate_cmd` unchanged):

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

Verdict on the July copy: not "exactly the nine skill moves" — not any report at all. Per the brief ("If
it is not exactly those nine moves … STOP and report — do not re-point"), this was a harder miss than
either prior measurement (`c1a8fbca`'s `skillMoves: []` on an unchanged config, or the bare-`3b2e2ca4`
`skillMoves: []` on a null config) — the CALL ITSELF could not complete on that seed. The open question it
left: a tracked historical `project.json`, however faithfully restored, predates the product's own schema
migration and can never validate against the CURRENT loader — the fixture needed a copy of the contract
file from the SAME MOMENT the product's schema was already current, which no commit in the source repo's
git history carries tracked (the schema migrated after the ignore already hid the file — see "Why not
`c1a8fbca`" above). That gap is what the live capture, below, closes.

## T1 1497 — the live capture (final)

A tarball of betterado's `.forge/` was captured directly off the LIVE ground on 2026-09-05T01:22Z — the
day this story was authored — at `HEAD 3b2e2ca4`, working tree clean (`git status --porcelain` empty).
Because the source repo's own git history never carries a TRACKED `project.json` in the current schema at
this SHA (the schema migration happened server-side, in the live ground's own untracked, gitignored copy,
after `e04638bc` dropped the tracked one and before PR #72 re-tracked a fresh one), a byte-exact capture of
the file as it stood on disk at that moment is the only way to get the REAL pre-rebuild contract in its
CURRENT-schema form. `project.json`'s content was independently confirmed: `testProcess` typed (no flat
`ci_gate`/`ci_fix_cmd`/`ci_gate_unset_env`/`acceptance_gate` keys — the schema this project actually ran
under when S3 was authored), `artifactRoot: "forge"`, and the same nine skill ids S3 has always declared.

**Deviation.** Restores the ignored-untracked contract file the live ground carried, from a byte-exact
capture of the live ground's `.forge/` taken 2026-09-05 at `3b2e2ca4` when this story was authored,
because a tracked-files archive cannot carry an ignored file.

**Evidence.**
- `.gitignore` at `3b2e2ca4`, line 12: `.forge/` — the whole directory is ignored (see "T1 1497, first
  attempt" above for the full comment); this is WHY `git archive`/`git show` can never produce this file at
  this SHA and a live, out-of-band capture was the only route.
- `e04638bc`'s merge dropped the tracked copy; `15a74d8a` (PR #72) narrowed the ignore so a fresh one could
  land tracked again — the same two facts recorded against the first attempt, now the reason NEITHER git
  history endpoint (`e04638bc^`'s stale schema, nor `3b2e2ca4`'s own tracked tree, which has none at all)
  can serve as this fixture's source; only a live capture, taken between those two events, can.
- File: 11395 bytes, sha256 `0b42c0188847bbf38f7605ec86779eccacd16df8e92696bcefa738a495cc93a4` (full digest;
  the ruling's short form `0b42c0188847bbf3` is this digest's first 16 hex characters). Copied byte-for-byte
  into `seed/.forge/project.json`; `sha256sum` of the seed file matches the capture exactly.
- Secrets-scanned before copying (own check, not merely trusted): the file contains environment-variable
  NAMES only (`AZDO_PERSONAL_ACCESS_TOKEN`, `TF_ACC`, `AZDO_ORG_SERVICE_URL`, inside `requiresEnv` arrays
  and prose comments) and no values, tokens, or secrets of any kind. Nothing else from the capture's `.forge/`
  (which also held live credentials under `.forge/demo/auth/`) was copied — `project.json` alone.
- `.forge/quality_gate_cmd` is unaffected — already present at `3b2e2ca4` itself, unchanged by either
  restoration attempt.

**Files.** Count unchanged at 125 (one file's CONTENT replaced, not added). Method-C digest of `seed/`
after this replacement: **`49416ee66caaf3d4`** (superseding the first attempt's `5d59188fe5785cf1`).

## PROOF — `computeContractDrift` on the live-capture seed

`computeContractDrift(seed, { appType: 'cli' })` returns a full report — no throw. `skillMoves` is EXACTLY
the nine relocations `forge/skills/<id>` → `.forge/skills/<id>` S3's `expectedChanges` name: `ado-api-explorer`,
`ado-browser-inspector`, `ado-demo`, `ado-release-explorer`, `breaking-change-detector`,
`resource-scaffolder`, `schema-refactor`, `tf-acceptance-test-author`, `tfplugindocs-gen`. Every other row:
`testProcess.local` → `preserve` (hand-authored), `testProcess.ci` → `preserve` (hand-authored),
`testProcess.acceptance` → `unchanged`, `standing_work_item_acs` → `unchanged`, `demoProcess` → `preserve`
(hand-authored), `releaseProcess` → `preserve` (starter-silent), `buildProcess` → `unchanged`, `skills` →
`regenerate` (the row that carries `skillMoves`). `gitignoreDrift.action: unchanged`, `commandAdvisories: []`.
Matches the brief's fence exactly — no widening, no STOP.

**What `applyContractReset` actually writes, verified by running it (not assumed).** Applied against a
provisioned copy of the seed: the nine skill directories move (`guardedRename`); `.forge/project.json` is
UNCONDITIONALLY re-serialised (`JSON.stringify(merged, null, 2) + '\n'`) whenever any row is
`'regenerate'`/`'add'` — here the `skills` row is `'regenerate'`, so the rewrite fires even though no
config VALUE changes. Diffed the before/after file: the only content difference is JSON string-escaping
normalisation (`—`→`—`, `→`→`→`, `⇒`→`⇒` — Node's `JSON.stringify` does not escape non-ASCII
by default) — zero semantic change. `.gitignore` is untouched (`gitignoreFixed: false` — the seed carries
none, so `gitignoreDrift.action` was already `unchanged`).

**expectedChanges widened — two classes, both `reset.ts`-verified, neither guessed.** Simulated the exact
fence function (`classifyOwnGroundDrift`, `scripts/stories/ground-hash.mjs`) against the seed's own
`groundIgnoreFromGit` (the fixture carries no `.gitignore`, so nothing is ignored on this ground — unlike
the real ground, where `.forge/`'s wholesale ignore at authoring time is why S3 only ever had to declare
the nine REMOVALS). Against the CURRENT nine-removal-only `expectedChanges`, the fence calls TEN paths
`UNDECLARED`: the nine ARRIVALS at `.forge/skills/<id>/SKILL.md` (`change: 'added'`) and the
`.forge/project.json` re-serialisation (`change: 'modified'`) — both real, both `beat: 5`, both written by
`applyContractReset` and nothing else. Added all ten to `expectedChanges`; re-ran the same simulation with
the full 19-entry set: `undeclared: []`, `unmatchedDeclarations: []`. Never widened past what
`applyContractReset` demonstrably writes.

**SUPERSEDED** once `.gitignore` was added to close C2 (below) — the ignore assumption this paragraph
states did not survive contact with the fence a second time. See "Re-derived `expectedChanges`, twice"
further down for the corrected, FINAL 20-entry set.

## Closing the beat-10 gap: `.gitignore`, `roadmap.md`, and a real Brain 3 profile

The first re-point measured `runPreflight` (`packages/projects/preflight.ts`) directly against a
provisioned-and-reset copy of `story-s3`: `ok: false`, two HARD failures — **C2** (the seed carried no
`.gitignore` at all, so forge's own scratch paths were not git-ignored) and **C4** (missing `roadmap.md`
AND missing `brain/projects/<story project>/profile.md`). Both are now fixed AT THE SOURCE, not papered over.

**`.gitignore` and `roadmap.md`, carried verbatim from `3b2e2ca4`** (both tracked there — confirmed with
`git -C <real ground> show 3b2e2ca4:.gitignore` / `:roadmap.md`, piped straight to the seed, byte-for-byte;
`diff` against a `git cat-file -p` re-read of each blob: no output). `.gitignore` line 12 is still the
blanket `.forge/` ignore this whole ground's story turns on (see "Why not `c1a8fbca`" above) — this is the
live ground's REAL behaviour at this pin, restored rather than invented. `roadmap.md`: 4822 bytes, the
project's own architecture context C4 reads. **Files: 127** (125 + these two), method-C digest of `seed/`:
**`94e16fb026da34b0`** (superseding `49416ee66caaf3d4`).

**A real Brain 3 profile, carried via a new harness capability.** C4 also needs
`brain/projects/<project>/profile.md` in the FORGE repo (this repo, not the seed) — keyed by the project's
own DIRECTORY NAME, a path Brain 3 lives at entirely outside `projects/`. A plain seed copy has no way to
carry it, so `scripts/stories/fixture-ground.mjs` grew the ability: a fixture MAY declare its own
`tests/stories/grounds/<fixture>/brain/` (a sibling of `seed/`); `provisionFixtureGround` copies it to
`brain/projects/<project>/` (refusing, before any write, if that destination already holds residue — the
same door `projects/<project>` already has) and `teardownFixtureGround` removes it, even when the ground
directory is already gone. `scripts/stories/fixture-ground-brain.test.ts` pins five cases red-first: creates
it, teardown removes it, no-`brain/`-source creates nothing, existing residue refuses, an orphaned profile
with no ground beside it is still removed. `sweep.mjs`'s `productFixturePathsFor` already listed
`brain/projects/<name>` for every `storyFixtureNames(storyId)` (found by the S1 worker, M5-B) — confirmed,
not re-implemented — and neither `run-story.mjs` nor `ground-hash.mjs` reference `brain/` at all, so this
addition sits entirely outside the own-ground digest fence (`ownGroundManifest` hashes only
`projects/<project>`) and needs no `expectedChanges` entry of its own.

This ground's own `brain/` source: `tests/stories/grounds/go-provider-old-contract/brain/profile.md`, copied VERBATIM from
**`brain/projects/terraform-provider-betterado/profile.md`** in THIS forge repo, `parsoFish/main`, commit
`9c18747cabb929719213096a55562c85bb93b650` (confirmed byte-identical to the working-tree copy at the time
of this carry — `git diff parsoFish/main -- brain/projects/terraform-provider-betterado/profile.md`: no
output). 8544 bytes, sha256
`48d337c449f3fbbbe0b562484a982727a25684703f9caaacd8c4783d4b3fe013`. Real, accumulated knowledge about this
exact codebase, carried under the fixture's OWN directory name (`brain/projects/<story project>/profile.md` once
provisioned) rather than a fabricated stand-in — the same disclosed-reuse the `kb` field already stands on
(below). `kb-select` is unaffected — there is no such beat in S3, and the `kb` field itself is untouched.

**A harness bug this carry exposed, fixed narrowly.** With `.gitignore` in place, `provisionFixtureGround`
itself THREW: `git add --pathspec-from-file` (no `-f`) refuses an explicitly-named path the seed's own
`.gitignore` covers — `.forge/project.json` and `.forge/quality_gate_cmd` are blanket-ignored by the
restored `.gitignore`, exactly the trap that `.gitignore`'s own comment names ("force-tracked via `git add
-f` so they survive this ignore"). Fixed by adding `-f` to that ONE call
(`scripts/stories/fixture-ground.mjs`). Safe because the file list passed is ALREADY the seed's own
curated, explicit set (never a glob, never `-A`) — `-f` cannot add anything the seed did not already name,
it only stops an incidental ignore rule from silently dropping one. Checked against every OTHER existing
fixture (`node-cli-with-tests`, `node-library`): both already carry a `.gitignore`, neither's ignore rules
cover any of their own tracked files, so the change is behaviourally inert for them — confirmed by re-running
their full test suites (no regressions, 50/50 green including the 5 new brain tests and 1 new
git-add-past-the-seed's-own-ignore test in `fixture-ground-provision.test.ts`, red-first).

## Re-derived `expectedChanges`, twice — 19 was not the final answer

First pass (no `.gitignore` in the seed): `classifyOwnGroundDrift`, simulated against a
provisioned-and-reset copy, showed the nine `.forge/skills/<id>/SKILL.md` ARRIVALS and the
`.forge/project.json` re-serialisation ALL fall to UNDECLARED unless declared — 19 total (9 removed + 9
added + 1 modified), proved exact: 0 undeclared, 0 unmatched.

Second pass, after `.gitignore` was restored so C2 could pass: re-ran the identical simulation expecting
the ignore to now absorb the nine arrivals the way it did on the real ground (the reasoning behind this
session's ruling). It does **not**. `groundIgnoreFromGit` runs `git check-ignore` against the ground's git
state AS THE RUN LEAVES IT — and beat 5's own press now ALSO fixes `.gitignore` (`gitignoreFixed: true`,
measured by actually running `applyContractReset`; PR #72's `15a74d8a`, "reset .gitignore [untrap tracked
contract config]", reproduced exactly). Checked against that FINAL, narrow `.gitignore`, none of
`.forge/skills/*` is ignored, so the nine arrivals are STILL undeclared with the 19-entry set — and the
`.gitignore` rewrite is an ELEVENTH new write the real ground's story never had to declare (there, PR #72's
fix landed three weeks after S3 was authored, never inside a run the fence judged).

```
declared: 20, undeclared: [], unmatchedDeclarations: []
changes.added:    9 × .forge/skills/<id>/SKILL.md
changes.removed:  9 × forge/skills/<id>/SKILL.md
changes.modified: .forge/project.json, .gitignore
```

Final `expectedChanges`: the original 9 `removed` + 9 `added` + `.forge/project.json` `modified` + ONE
new entry, `.gitignore` `modified`, beat 5 — 20 total. Every path `applyContractReset` demonstrably writes
on this ground and nothing wider. The hypothesis that carrying `.gitignore` would SHRINK the declared set
back toward the nine removals is recorded here as REFUTED, with the evidence, rather than silently
discarded.

## S3 IS re-pointed

`tests/stories/S3.story.mjs` now declares `ground: { project: 'story-s3', fixture:
'go-provider-old-contract', realSpawn: true, budget_usd: 25, expectedChanges: […20 entries…] }`. Every
real-ground token (routes, `card-id`/`project-id`, fills, narration) re-authored to `story-s3`; `NORTH_STAR`
and `GATE` constants unchanged (verbatim from the restored contract, matching what the fixture's
`.forge/project.json`/`quality_gate_cmd` actually carry); the `kb` field stays `terraform-provider-betterado`
(untouched — it travelled with the byte-exact `project.json` capture), per S4's precedent for a field the
fence does not require a fixture-side asset for.

**Beat 10 is CONFIRMED, not merely declared.** `runPreflight` against a provisioned-and-reset copy of the
corrected fixture (with `.gitignore`, `roadmap.md` and the Brain 3 profile all in place): `ok: true` — every
HARD clause passes (C1, C1b, C2, C4, SKILLS). The remaining FAILs are all soft/advisory and expected of a
fixture with no GitHub remote and no release-process substrate: **C6** (no GitHub `origin` — this ground has
none), **C10** (`releaseProcess` names `CHANGELOG.md`/`PROVIDER_VERSION.txt`/`docs/` that this GATE-closure
carry never included), **DEMO-SKILL** (no `.forge/skills/demo-design/SKILL.md` — never bound), **DEMO-ALIGN**
(the screenshot capture step doesn't literally reference the test process — true on the real ground too).
None are hard; `ok` is unaffected. The readiness panel's own five UI checks (north star ≤140 chars,
instructions present, demo has capture+verify, ≥1 skill bound, kb bound) all independently pass, so
`ready-count: 5` and `flow-ready: true` hold for real. Beat 10's assertion in `S3.story.mjs` is unchanged
from what the story always declared — this session confirmed it rather than weakening or fabricating it.

**Stories served.** S3 (`tests/stories/S3.story.mjs`), all 12 beats re-pointed and file-scoped clean; no
open caveats remain.
