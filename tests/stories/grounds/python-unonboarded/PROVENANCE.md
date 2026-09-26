# Fixture ground `python-unonboarded`

**Shape.** A real, un-onboarded Python project: a Terraform control repo whose own tests are
Python (`pytest`), and **no `.forge/` directory anywhere in the tree**. S1 (onboard an existing
project) needs a project forge has never seen — no contract, no project skill, nothing scaffolded
— so that the story's own premise ("this absence is the starting state, not a fault") is true of
the ground it stands on rather than merely asserted about it.

**Source.** `parsoFish/GitWeave` at `5737e380934fd644a71a92b5822cfead71e44ba6` (plan D4, M7-D
`forge-1rk5.1`), read from the real, read-only ground at `projects/gitweave` — extracted with
`git -C projects/gitweave archive 5737e38`, tracked files only. Method-C digest of `seed/`:
`adebdb6399d7453d`, identical to the method-C digest of the real `projects/gitweave` working
directory at the time this fixture was cut (confirmed byte-for-byte with a recursive diff), and
the same number the fence's own `ground-hash.mjs` header already cites as this ground's pristine
hash from an earlier incident. There is no earlier ratified pin for a DIFFERENT tree at this name,
so this digest is the one this fixture stands on.

**Files.** All 139 tracked files of the source, byte-identical, under `seed/` beside this file.
Regenerate the list with:

```
git -C projects/gitweave archive 5737e380934fd644a71a92b5822cfead71e44ba6 | tar -tf -
```

**Deviations from the source.** None. `git archive` of a tracked tree already excludes
`node_modules/`, `.git/` and everything `.gitignore`d at this commit; none of that content was
ever in the archive to drop. There is no `.forge/` directory to strip — the source has none at
this SHA (checked directly: `git -C projects/gitweave ls-tree -r --name-only 5737e38 | grep -i
'^\.forge'` returns nothing), which is exactly the shape S1 needs and not a fixture-authoring
choice.

**Quality gate, checked before freezing.** GitWeave's own README, first line, names the project;
its test command is `python -m pytest tests/` (S1's own `GATE` constant, taken from the project
directly — there is no `pyproject.toml`, `pytest.ini`, `setup.cfg` or `tox.ini` at this SHA, so
this is the whole of the repo's own test configuration). Run inside a temp copy of `seed/`
(`mkdtemp`, `git archive | tar -x`, `python3 -m pytest tests/ -q`, deleted afterward): **323
failed, 774 passed, 72 skipped, 36 subtests passed in 131.51s** — exit 1. **The seed is RED at
HEAD**, matching the standing memory finding that GitWeave's `pytest tests/` was red in April;
re-measured directly against this pinned SHA rather than assumed carried forward. Not fixed, and
not trimmed: onboarding an unhealthy project is the realistic case, and this is what S1's own
onboarding agent (`skills/onboarding-agent`) has to report honestly against, same as the real
ground did.

**NOT FULLY OFFLINE — a trait, not a defect of this fixture.** A minority of the suite performs
real network I/O rather than running hermetically: `tests/test_tf_oidc_structure.py` and friends
drive `terraform init` under `infra/`, which fetched the `integrations/github` provider from
`registry.terraform.io` on the measurement host, and `tests/test_python_service_module.py`'s
copier-integration tests provision a fresh `.venv` and install real packages from PyPI
(`fastapi`, `httpx`, `sqlalchemy`, `alembic`, `asyncpg`, … — 78 top-level `site-packages` entries
after one run). Both succeeded on the measurement host (network was reachable) and both write
well outside `seed/` (a `mkdtemp` copy), so they cost nothing here, but a host with no network route
to `registry.terraform.io` or PyPI would see additional failures beyond the 323 above. Recorded as
a trait rather than fixed: GitWeave's tests were written this way in its own repo, and rewriting
them to be hermetic would be exactly the "trim tests to make it green" the brief forbids.

**Traits carried, and the learning each encodes.**

- **No `.forge/` anywhere.** This is the fixture's entire reason to exist: S1 asserts
  `health="attention"` / "no `.forge/project.json` — onboarding is unfinished" against a project
  forge has genuinely never touched, and freezing it here means that premise can never age out from
  under the story the way a live ground's premise can (§15.205 — the same risk `node-cli-with-tests`
  closed for S4's idea, applied here to S1's starting condition instead).
- `.gitignore` already rules `node_modules/`, `dist/`, `coverage/`, `.venv/`, `venv/`, `.terraform/`,
  `.terraform.lock.hcl` and `__pycache__/` — so a `python -m pytest` run's own venv, provider cache
  and bytecode cache are all **ignored-born**, not undeclared, the same rule `node-cli-with-tests`
  and `node-library` already exercise for a session-scratch directory landing inside an ignored
  path (bead `forge-8vfn.7.6.52`). **`.pytest_cache/` is the one exception** — this `.gitignore` does
  not mention it, so a run that writes it is genuinely **undeclared**, not ignored-born. Measured,
  not assumed: a full `python -m pytest tests/` run in a temp copy left exactly four `__pycache__/`
  dirs (ignored) and one top-level `.pytest_cache/` (not ignored) behind. This is the seed's own
  `.gitignore` as GitWeave wrote it; per the brief this is recorded, not changed. S1's own
  ignored-born classification (bead `forge-8vfn.16`) learned from exactly this split on the real
  ground, where a single onboarding run's repeated `pytest` invocations (plus the network-fetched
  venv and provider cache above) produced roughly 4,500 untracked paths at once — almost all of them
  landing inside an ignored root, with `.pytest_cache/` the standing exception.
- **A real, materially complex Python project** — 139 tracked files, real Terraform modules, a real
  GitHub Actions pipeline (`.github/`), Copier-templated module scaffolding, and 43 test files
  covering structure, schema and Terraform-plan assertions — not a toy. It gives the onboarding
  agent (and the architect that plans against it afterward) a real quality-gate command, a real
  README to source the north star from, and real advisory-clause gaps (no `.forge/constraints.md`,
  no GitHub remote once provisioned as a fixture — see below) to report on, same as the live ground
  did.
- **No GitHub remote once provisioned.** `provisionFixtureGround` runs a bare `git init` with no
  `remote add` — every fixture ground is a local-only repository. Preflight's C6 ("satisfiable
  merge model") is **advisory, and structurally so** (`packages/projects/preflight-repo.ts`:
  `checkC6`'s `hard` is always `false`; its own fix hint says "the skill must never add a remote
  itself — this is the operator's to do", `packages/projects/preflight-resolve.ts:54`). A missing
  remote can never block `preflight-status: 'ok'` or `flow-ready: 'true'`, and no skill in the
  onboarding path (`skills/onboarding-agent`, `skills/forge-onboard-project`, `skills/architect`,
  `skills/demo-design`) ever runs `git push`, `git remote add` or `gh pr create` — checked directly,
  no hits. So S1 needs no remote at all on this fixture; D6's remote-minting work is not a
  dependency of this re-point.
- Provisioned as its OWN git repository (the harness runs `git init` on the copy), same as every
  other fixture ground. Its source is a plain directory inside this repo, where
  `git -C projects/gitweave status` walks up and reports the forge worktree — a dirty ground read
  clean, same caveat `node-cli-with-tests` already names.

**Stories served.** S1.
