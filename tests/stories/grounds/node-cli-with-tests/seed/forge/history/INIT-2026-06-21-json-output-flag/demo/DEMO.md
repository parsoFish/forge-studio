# Add --json flag to gitpulse CLI for machine-readable analytics output

> _Derived from `demo.json` (ADR 021). Essence:_ The gitpulse CLI gains a --json flag that serialises the already-computed Summary struct to stdout as stable, two-space-indented JSON, enabling downstream tools (scripts, CI dashboards) to consume analytics programmatically without recomputation. Error behaviour (exit codes 1 and 2) is unchanged; --top cap applies to all arrays in JSON output exactly as for table output.

## Intent & Outcome

> _Assessed intent:_ The gitpulse CLI gains a --json flag that serialises the already-computed Summary struct to stdout as stable, two-space-indented JSON, enabling downstream tools (scripts, CI dashboards) to consume analytics programmatically without recomputation. Error behaviour (exit codes 1 and 2) is unchanged; --top cap applies to all arrays in JSON output exactly as for table output.

| # | Acceptance criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | GIVEN the CLI is invoked with --json and a stub reader returning commits WHEN runCli executes successfully THEN result.code is 0, result.stdout is valid JSON parseable by JSON.parse, result.stderr is empty, and JSON has keys: totalCommits, firstDate, lastDate, byAuthor, authorChurn, fileChurn, ownershipEntries, hotspotEntries | ✓ met | test/json-output.test.ts: 'AC1: --json exits 0 and stdout is valid JSON' → pass; 'AC1: --json stdout JSON carries all required top-level keys' → pass; 'AC1: --json does not leak table output to stderr' → pass (npm test 16/16 green). All 16 unit tests pass including 5 AC1-covering cases. |
| 2 | GIVEN the CLI is invoked with --json and a reader that throws WHEN the reader throws an error THEN result.code is 1, result.stdout is empty, and result.stderr carries the error message (same as without --json) | ✓ met | test/json-output.test.ts: 'AC2: --json with throwing reader exits 1' → pass; 'AC2: --json with throwing reader has empty stdout' → pass; 'AC2: --json with throwing reader carries the error message in stderr' → pass; 'AC2: --json error behaviour matches non-json error behaviour' → pass (npm test 16/16 green). |
| 3 | GIVEN the CLI is invoked with --json --frobnicate WHEN arg parsing runs THEN result.code is 2, result.stderr matches /unknown option/, and result.stdout is empty | ✓ met | test/json-output.test.ts: 'AC3: --json --frobnicate exits 2' → pass; 'AC3: --json --frobnicate stderr matches /unknown option/' → pass; 'AC3: --json --frobnicate stdout is empty' → pass; 'AC3: --frobnicate --json also exits 2 with /unknown option/' → pass (npm test 16/16 green). |
| 4 | GIVEN the CLI is invoked with --json --top 2 and a stub reader with >=3 authors WHEN the run succeeds THEN JSON.parse(stdout).byAuthor has exactly 2 entries, and authorChurn, fileChurn, hotspotEntries, ownershipEntries are all capped at 2 entries | ✓ met | test/json-output.test.ts: 'AC4: --json --top 2 byAuthor has exactly 2 entries' → pass; 'AC4: --json --top 2 authorChurn has exactly 2 entries' → pass; 'AC4: --json --top 2 fileChurn has at most 2 entries' → pass; 'AC4: --json --top 2 ownershipEntries has at most 2 entries' → pass; 'AC4: --json --top 2 with file-bearing commits caps fileChurn to 2' → pass (npm test 16/16 green). |
| 5 | GIVEN serializeSummary is called with a populated Summary WHEN the function executes THEN the return value is valid JSON (JSON.parse succeeds) and the top-level keys match: totalCommits, firstDate, lastDate, byAuthor, authorChurn, fileChurn, ownershipEntries, hotspotEntries | ✓ met | test/json-output.test.ts: 'AC5: serializeSummary returns valid JSON with all required top-level keys' → pass; 'AC5: serializeSummary output is round-trip stable (JSON.parse → JSON.stringify)' → pass (npm test 16/16 green). serializeSummary calls JSON.stringify(s, null, 2) — the Summary type already matches the documented shape. |
| 6 | GIVEN the deterministic fixture repo (Ada Lovelace: 3 commits, Grace Hopper: 1 commit; dates 2021-03-01 to 2021-03-07) WHEN the built CLI is invoked with --json <fixture-repo> THEN JSON.parse(stdout).totalCommits === 4, byAuthor[0].author === 'Ada Lovelace', byAuthor[0].commits === 3, firstDate === '2021-03-01', lastDate === '2021-03-07', and the acceptance run exits 0 | ✓ met | npm run demo output: 'acceptance: PASS — built CLI produced the expected commit-stats for the fixture repo.' JSON read-back in demo/pulse-capture.md: totalCommits=4 PASS, byAuthor[0].author='Ada Lovelace' PASS, byAuthor[0].commits=3 PASS, firstDate='2021-03-01' PASS, lastDate='2021-03-07' PASS. test/acceptance/run.ts asserts these at lines 228-245 and exits 0. |
| 7 | GIVEN the acceptance suite runs with --json against the fixture repo WHEN the JSON run completes THEN stdout is parseable JSON (JSON.parse does not throw) with all eight top-level keys present: totalCommits, firstDate, lastDate, byAuthor, authorChurn, fileChurn, ownershipEntries, hotspotEntries | ✓ met | npm run demo: acceptance PASS. test/acceptance/run.ts lines 243-255 assert all 8 required keys present. All keys confirmed present in pulse-capture.md ## JSON read-back section. |
| 8 | GIVEN the demo evidence is written (npm run demo) WHEN the --demo flag is passed THEN the captured pulse-capture.md evidence block includes the JSON read-back assertion results | ✓ met | npm run demo produced demo/pulse-capture.md with '## JSON read-back' section showing: totalCommits=4 PASS, byAuthor[0].author='Ada Lovelace' PASS, byAuthor[0].commits=3 PASS, firstDate='2021-03-01' PASS, lastDate='2021-03-07' PASS, all 8 keys PASS. Result: PASS. |

## Visual Changes

### CLI run with --json against fixture repo — full summary as JSON

- **Before:** No --json flag existed; only human-readable table output was available; downstream tools could not parse stdout programmatically
- **After:** With --json: stdout is a single JSON object with keys totalCommits=4, byAuthor[0].author='Ada Lovelace', byAuthor[0].commits=3, firstDate='2021-03-01', lastDate='2021-03-07', plus authorChurn, fileChurn, ownershipEntries, hotspotEntries; stderr empty; exit 0

### CLI invoked with --json and a non-git path — errors still on stderr

- **Before:** Error behaviour only defined for table mode
- **After:** With --json and an invalid repo: exit code 1, stdout empty, stderr carries the error message — identical to non-json error behaviour

### CLI invoked with both --json and an unknown flag

- **Before:** Unknown flags caused exit 2 in table mode only
- **After:** With --json --frobnicate: exit 2, stderr matches /unknown option/, stdout empty — flag parsing order-independent

### CLI invoked with --json --top 2 against 3-author fixture — all arrays bounded

- **Before:** --top cap only applied to table output
- **After:** With --json --top 2: byAuthor has exactly 2 entries, authorChurn 2 entries, fileChurn ≤2, hotspotEntries ≤2, ownershipEntries ≤2 — consistent with table behaviour

## Test Evidence

| test | result | delta |
|---|---|---|
| AC5: serializeSummary returns valid JSON with all required top-level keys | pass | new |
| AC5: serializeSummary output is round-trip stable (JSON.parse → JSON.stringify) | pass | new |
| AC1: --json exits 0 and stdout is valid JSON | pass | new |
| AC1: --json stdout JSON carries all required top-level keys | pass | new |
| AC1: --json stdout totalCommits matches fixture | pass | new |
| AC1: --json stdout firstDate and lastDate are sentinel values from fixture | pass | new |
| AC1: --json does not leak table output to stderr | pass | new |
| AC2: --json with throwing reader exits 1 | pass | new |
| AC2: --json with throwing reader has empty stdout | pass | new |
| AC2: --json with throwing reader carries the error message in stderr | pass | new |
| AC2: --json error behaviour matches non-json error behaviour | pass | new |
| AC3: --json --frobnicate exits 2 | pass | new |
| AC3: --json --frobnicate stderr matches /unknown option/ | pass | new |
| AC3: --json --frobnicate stdout is empty | pass | new |
| AC3: --frobnicate --json also exits 2 with /unknown option/ | pass | new |
| AC4: --json --top 2 byAuthor has exactly 2 entries | pass | new |
| AC4: --json --top 2 authorChurn has exactly 2 entries | pass | new |
| AC4: --json --top 2 fileChurn has at most 2 entries | pass | new |
| AC4: --json --top 2 hotspotEntries has at most 2 entries | pass | new |
| AC4: --json --top 2 ownershipEntries has at most 2 entries | pass | new |
| AC4: --json --top 2 with file-bearing commits caps fileChurn to 2 | pass | new |
| without --json flag, stdout is still a human-readable table | pass | new |
| acceptance: --json JSON read-back against fixture repo (npm run acceptance) | pass | new |

> result: **pass**/**fail** · **skip** = not run in this gate (e.g. a live test with no credentials present) — not a failure · delta **new** = test added by this change.

## Files Changed

```
5 files changed, 359 insertions(+), 6 deletions(-)
```
