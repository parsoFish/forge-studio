# Cycle traces — real failed cycles, trimmed to the window the classifier reads

Five real `events.jsonl` logs from cycles that actually ran, kept so
`classifyCycleFailure` is judged against **what forge did**, not against
hand-written events shaped like what we expect it to do.

## Provenance

Every file is a trim of a cycle archived in the campaign's trace set. Their
full logs are 491–648 events; what is committed here is **exactly the window
`windowSinceLastPhaseStart` computes** — the slice from the last `start` event
up to the point the cycle emitted its own `failure_classification`.

| fixture | cycle | full → trimmed | what really happened |
|---|---|---|---|
| `2026-07-11T07-29-19_…exclude-path-filter` | gitpulse `--exclude` path filter | 30 → 27 | PM emitted 3 WIs; WI-3 had no `creates` (ADR 037) |
| `2026-07-11T14-57-10_…csv-output-flag` | gitpulse `--csv` | 35 → 32 | PM emitted 4 WIs; WI-2 and WI-4 had no `creates` |
| `2026-07-11T16-18-59_…tags-command` | gitpulse `tags` subcommand | 35 → 32 | PM emitted 4 WIs; WI-4 had no `creates` |
| `2026-07-11T17-26-34_…cli-sort-flag` | gitpulse `--sort` | 30 → 27 | PM emitted 3 WIs; WI-3 had no `creates` |
| `2026-08-03T01-16-00_…coupling-command` | gitpulse `coupling` subcommand | 584 → 47 | the delivery gate's demo pipeline failed (`author-invalid`) |

## Why the trim stops where it does

`classifyCycleFailure` reads **only** the window from the last `start`
(`windowSinceLastPhaseStart`), so cutting to exactly that window removes
nothing the function can see. That boundary is the classifier's own, not one
chosen here — which is what makes the trim provable rather than editorial.

Each trim was verified in both directions before being committed: the trimmed
file classifies **identically to the full prefix**, and the full prefix
classifies **identically to the verdict the cycle recorded live** in its own
`failure_classification` event. A fixture whose verdict drifts from the
recorded one is therefore reporting a real change in the classifier, never an
artefact of the trim.

## Why they were not trimmed further

Dropping `agent_heartbeat`, `tool_use` and `log` events was measured and
**preserves every verdict** — it would take these five files from 116 KiB to
about 31 KiB. It was rejected anyway: `log` events are where nearly every
signal the classifier reads actually lives (`ralph.end`, `gate.fail`,
`unifier.failed`, `pm.empty-decomposition`, `cost-ceiling:` …), so a fixture
without them would keep passing for a classifier that had stopped reading them.
A regression fixture that survives the deletion of the thing it tests is not a
regression fixture.

## The sixth trace, and why it is not here

The betterado `gap-registry` cycle's window is 1,414 events / 881 KiB — the
last `start` is a developer-loop start, a long way back. It is also the one
trace that already classifies correctly (`cost ceiling reached — flow spent
$80.8324 which meets or exceeds the $52.00 ceiling`), so it would be a control,
and there is already a control here that costs 26 KiB.

It is worth recording what replaying it showed, because it is good news that
would otherwise be invisible: at all four of its classification points the
**current** classifier beats the one that ran in August 2026. Its three
`hidden coupling` verdicts now carry a deterministic explanation, and its final
`failure could not be classified` now reads `cost ceiling reached`. Those are
fixes that landed since, recorded here rather than carried as a 900 KiB blob.
