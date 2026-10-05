# Fixture ground `node-returning-no-contract`

**Shape.** A **returning project**: a real forge-owned Brain 3 (`brain/`, sibling of `seed/`,
mirroring `node-cli-with-tests`' own optional `brain/` convention) and a real project
`forge/history/` slice, but **no `.forge/` directory anywhere in `seed/`** — the fifth fixture
shape, a sibling of `python-unonboarded`'s "never-onboarded" shape. Bead `forge-mfv5.2.6` asks
whether forge's onboarding path treats a project like this — prior merged forge initiatives and a
project history convention, but no contract file — as *returning* (preserving the existing brain
and history) or as *greenfield* (discarding or duplicating them). trafficGame is the real project
this shape is drawn from (a Brain 3 with 21 real theme pages and no `.forge/project.json` at the
time this bead was filed); this fixture does not carry trafficGame's own content (see "Brain 3
stub" below) — it exists so the question can be answered with a pinned, provenance-recorded test
rather than by poking the real trafficGame project by hand.

## `seed/` — real, corpus-grounded

**Source.** `parsoFish/gitpulse` at `8d853dc9e83ad30edddb7a6fcbfa90b1b1753054` — the SAME source and
SHA already pinned for the `node-cli-with-tests` ground (see its own `PROVENANCE.md`). Rather than
re-deriving from a live `git archive` of `projects/gitpulse`, every file below was copied from
`tests/stories/grounds/node-cli-with-tests/seed/` — itself already extracted from that exact commit
and pinned there (digest `0d0dff0bc55c0d07` over its own, larger `seed/`) — and verified
byte-for-byte identical against it with `cmp` before this file was written. This avoids a second,
independently-run extraction of the same commit that could silently diverge from the first.

**Files.** 6 tracked files, byte-identical to their `node-cli-with-tests` counterparts:

```
CLAUDE.md
README.md
package.json
forge/history/INIT-2026-06-21-gitpulse-code-churn/demo/DEMO.md
forge/history/INIT-2026-06-21-gitpulse-code-churn/demo/demo.json
forge/history/INIT-2026-06-21-gitpulse-code-churn/demo/pulse-capture.md
```

Method-C digest of `seed/` (`node scripts/stories/ground-hash.mjs`'s `groundManifest`, the same
function `fixture-ground-digests.test.ts` pins every ground against): **`836208005cd5ee08`**, 6
files.

**Deviations from the source.** Deliberately NOT a full copy of `node-cli-with-tests/seed/` (100
files) — this ground exists to test Brain 3 + history preservation on a returning project, not to
be a buildable/testable CLI, and the brief for `forge-mfv5.2.6` asks for "a handful of files."
Carried: `CLAUDE.md` (documents the `forge/history/<initiative-id>/` convention this ground
exists to exercise), `README.md` and `package.json` (so the seed reads as a real project, not a
bare history directory), and one whole initiative's `forge/history/.../demo/` slice — the FIRST
initiative in gitpulse's own recorded history
(`INIT-2026-06-21-gitpulse-code-churn`, 36 KB, 3 files), chosen for being the smallest of
gitpulse's 15 recorded initiatives at that SHA (measured: every other initiative's `demo/` is
52 KB or larger). Not carried: `src/`, `test/`, `.git*`, `docs/`, `tsconfig.json` and every other
initiative's history — none of this fixture's assertions touch them, and carrying them would
contradict "keep the fixture small." A consequence of the trim: `package.json`'s `scripts.test`
(`node --import tsx --test test/unit.test.ts`) and `CLAUDE.md`'s build/test invocations do not
resolve in this seed alone (there is no `src/` or `test/` to run) — this ground is not intended to
be built or have its own quality gate run; nothing in the onboarding path this ground exercises
reads or executes either file's contents (`handleProjectsOnboard` takes `qualityGateCmd` from the
onboarding REQUEST BODY, never from the project's own `package.json`).

**No `.forge/` anywhere.** Checked directly: `find seed -iname '.forge' -o -ipath '*.forge*'`
returns nothing. This is the fixture's own half of the bead's premise — a real history convention,
with no contract file — the same role `python-unonboarded`'s absent `.forge/` plays for "never
onboarded at all."

## `brain/` — SYNTHETIC, sibling of `seed/`

**This directory is entirely SYNTHETIC.** It is shaped from the STRUCTURE (frontmatter fields,
section headings) of two real Brain 3 files — `brain/projects/trafficGame/profile.md` and
`brain/projects/trafficGame/themes/per-map-calibrated-thresholds.md`, the real project this bead
names — but every fact, id and sentence inside it is invented and neutral, and every file carries
an explicit `> **SYNTHETIC.**` banner in its own rendered body, not only in this PROVENANCE. It
must never be read as real project knowledge, trafficGame's or anyone else's.

**Files** (4):

```
kb.yaml
profile.md
themes/2026-01-01-fixture-pattern-example.md
themes/2026-01-01-fixture-antipattern-example.md
```

`kb.yaml` and `profile.md` mirror the field shape of a real seeded Brain 3 (compare
`brain/projects/trafficGame/kb.yaml` and `packages/knowledge/project-brain-seed.ts`'s
`buildKbYaml`/`buildProfileMd`) — a returning project's Brain 3 is not always bare; it can already
carry the full seeded shape, and the onboarding test exercises exactly that: kb.yaml and profile.md
BOTH already exist before onboarding runs, same as the two theme pages. `themes/` deliberately
carries no `README.md` of its own — matching the real trafficGame Brain 3's `themes/`, which has
none either — so an onboarding run that creates one (`seedProjectBrain` treats it as one of its
three fixed, idempotent-per-file targets) is a change to what did NOT exist before, never to
anything asserted in this fixture.

**Project id used when this fixture is exercised.** `returning-cli` — a deliberately generic,
obviously-synthetic slug, chosen so nothing in `brain/` reads as a re-onboarding of the REAL
trafficGame or gitpulse projects. (`seed/`'s own files still say "gitpulse" throughout, being
byte-identical copies of gitpulse's real files — the same "seed's internal identity differs from
the id it is provisioned/onboarded under" shape `node-cli-with-tests`' own `PROVENANCE.md` already
documents for `story-s4`.)

**Quality gate.** Not applicable — this ground carries no `.forge/project.json` (that absence is
the point) and its trimmed `seed/` is not buildable (see "Deviations" above). No quality gate is
declared or run against it.

**Stories served.** None — this ground is not wired into the story harness
(`scripts/stories/fixture-ground.mjs`'s `provisionFixtureGround`/`teardownFixtureGround`, which
copy a `<fixture>/brain/` sibling into `brain/projects/<STORY'S OWN project id>` for a live story
run). It is consumed directly by a regression test that drives the real onboarding route with its
own tmp forge root and copies `seed/` + `brain/` into it by hand, the same "set up a brain root"
pattern `packages/knowledge/tests/unit/project-brain-seed.test.ts` and
`apps/forge/tests/regression/onboard-born-green.test.ts` already use:
`apps/forge/tests/regression/onboard-returning-project-preserves-brain-and-history.test.ts` (bead
`forge-mfv5.2.6`). Registered in `scripts/stories/fixture-ground-digests.test.ts`'s `PINNED` table
so this ground cannot drift unpinned, same as every other fixture on disk.

- **Deviation (docs refactor W3):** de-referenced decision-record citations: the old citation → `(D-07)` in `seed/forge/history/INIT-2026-06-21-gitpulse-code-churn/demo/DEMO.md`. Method-C digest of `seed/` is now **`22ccb2f298e13344`** (6 files; was `836208005cd5ee08`).
