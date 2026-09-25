# gitpulse coupling demo evidence

## Command invoked

```
node dist/cli.js coupling <temp-coupling-fixture-repo>
```

Fixture: 5 deterministic commits — Alice Engineer and Bob Developer,
fixed GIT_AUTHOR_DATE values (2024-06-01 to 2024-06-05).

## Raw stdout from coupling invocation

```text
fileA          fileB      co-changes  coupling%
-------------  ---------  ----------  ---------
engine.ts      router.ts           3      75.0%
middleware.ts  router.ts           1      25.0%

2 coupled pairs
```

## Read-back result

- First row contains `engine.ts`, `router.ts`, `3` co-changes, `75.0%`: **PASS**
- Second row contains `router.ts` ↔ `middleware.ts`: **PASS**
- Output does not contain "no coupled file pairs found": **PASS**

Result: **PASS** — the coupling output matches the sentinel values.
