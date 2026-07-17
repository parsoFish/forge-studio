# verify:cycle idea files

Hand-authored initiative ideas fed to the real-capability harness
(`scripts/verify-cycle.mjs`, [ADR 022](../decisions/022-real-capability-harness.md))
via its `--idea-file <path>` flag. Each is a small, self-contained feature for a
creds-free reference project, used to drive a **real** end-to-end cycle
(architect → PM → dev-loop → unifier → review → merge) against a managed project
without needing live credentials.

The current set targets **gitpulse** (`github.com/parsoFish/gitpulse`) — forge's
independent verify ground (a git-analytics CLI):

| File | Idea |
|---|---|
| [`gitpulse-compare-refs.md`](./gitpulse-compare-refs.md) | `--compare <ref>` analytics delta between two refs |
| [`gitpulse-exclude-paths.md`](./gitpulse-exclude-paths.md) | Repeatable `--exclude <glob>` path filtering |
| [`gitpulse-json-output.md`](./gitpulse-json-output.md) | Global `--json` structured-output flag |
| [`gitpulse-ownership-hotspots.md`](./gitpulse-ownership-hotspots.md) | Ownership & hotspot analysis |
| [`gitpulse-sort-flag.md`](./gitpulse-sort-flag.md) | `--sort <column>[:asc\|:desc]` output ordering |
| [`gitpulse-tags-cadence.md`](./gitpulse-tags-cadence.md) | `gitpulse tags` release-cadence command |

Usage:

```bash
node scripts/verify-cycle.mjs <run-handle> --project gitpulse \
  --idea-file docs/verify-cycle-ideas/<file>.md
```

`verify:cycle` is real-money (it runs a full agentic cycle); run it deliberately as
a manual capability gate, not in routine CI.

**Note (2026-07-17, R5-07-F4):** `scripts/verify-cycle.mjs`'s `--project` flag
literally defaults to `mdtoc`, but `mdtoc` is uniquely committed inside
forge's own repo (`projects/mdtoc/`) and must **never** actually be the
harness ground — the routine, creds-free ground is always `gitpulse`
(`--project gitpulse`, this corpus), an independent repo; `betterado`
(`--project terraform-provider-betterado`) is the live-ADO tier. `CLAUDE.md`
states the same canonical grounds.
