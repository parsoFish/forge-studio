# gitpulse demo evidence

## Command

```
node dist/cli.js <temp-fixture-repo>
```

## Captured output (the real generated report)

```text
gitpulse — 6 commits (2021-03-01 → 2021-04-03)

commits  author
-------  ------
      5  Ada Lovelace
      1  Grace Hopper

churn (lines)  author
-------------  ------
        +5/-0  Ada Lovelace
        +1/-0  Grace Hopper

churn (lines)  file
-------------  ----
        +1/-0  algebra.ts
        +1/-0  compiler.ts
        +1/-0  engine.ts
        +1/-0  loom.ts
        +1/-0  notes.md
        +1/-0  punch-card.ts

ownership
owner         bus-factor  file
------------  ----------  ----
Ada Lovelace           1  algebra.ts
Grace Hopper           1  compiler.ts
Ada Lovelace           1  engine.ts
Ada Lovelace           1  loom.ts
Ada Lovelace           1  notes.md
Ada Lovelace           1  punch-card.ts

hotspots
score  commits  last-date   file
-----  -------  ----------  ----
 0.00        1  2021-04-03  punch-card.ts
 0.00        1  2021-04-01  algebra.ts
 0.00        1  2021-03-07  loom.ts
 0.00        1  2021-03-04  notes.md
 0.00        1  2021-03-02  compiler.ts
 0.00        1  2021-03-01  engine.ts
```

## Windowed output (--since 2021-03-02)

```text
gitpulse — 5 commits (2021-03-02 → 2021-04-03)

commits  author
-------  ------
      4  Ada Lovelace
      1  Grace Hopper

churn (lines)  author
-------------  ------
        +4/-0  Ada Lovelace
        +1/-0  Grace Hopper

churn (lines)  file
-------------  ----
        +1/-0  algebra.ts
        +1/-0  compiler.ts
        +1/-0  loom.ts
        +1/-0  notes.md
        +1/-0  punch-card.ts

ownership
owner         bus-factor  file
------------  ----------  ----
Ada Lovelace           1  algebra.ts
Grace Hopper           1  compiler.ts
Ada Lovelace           1  loom.ts
Ada Lovelace           1  notes.md
Ada Lovelace           1  punch-card.ts

hotspots
score  commits  last-date   file
-----  -------  ----------  ----
 0.00        1  2021-04-03  punch-card.ts
 0.00        1  2021-04-01  algebra.ts
 0.00        1  2021-03-07  loom.ts
 0.00        1  2021-03-04  notes.md
 0.00        1  2021-03-02  compiler.ts
```

## Read-back assertion

- Total commits: **6** (four non-merge commits, two authors).
- Top author: **Ada Lovelace** with **5** commits.
- Date range: **2021-03-01 → 2021-04-03** (fixed GIT_AUTHOR_DATE sentinels).
- Top churn file: **algebra.ts** (path tie-break ascending).
- Author churn: **Ada Lovelace** with non-zero insertions.
- Windowed (--since 2021-03-02): **5** commits.

Result: **PASS** — the captured report matches the asserted sentinels.

## JSON read-back

```
node dist/cli.js --json <temp-fixture-repo>
```

- `totalCommits`: **6** — PASS (expected 6)
- `byAuthor[0].author`: **Ada Lovelace** — PASS (expected Ada Lovelace)
- `byAuthor[0].commits`: **5** — PASS (expected 5)
- `firstDate`: **2021-03-01** — PASS (expected 2021-03-01)
- `lastDate`: **2021-04-03** — PASS (expected 2021-04-03)
- All 8 top-level keys present: **PASS**

Result: **PASS** — JSON output parsed successfully with all sentinel values matching.

## --compare v0.1 delta report

```
node dist/cli.js <temp-fixture-repo> --compare v0.1
```

```text
gitpulse — delta since v0.1

               head  base  delta
-------------  ----  ----  -----
      commits     6     4     +2
  lines added     6     4     +2
lines removed     0     0      0

Δcommits  Δlines  author
--------  ------  ------
      +2      +2  Ada Lovelace
       0       0  Grace Hopper
```

- `delta.commits`: **2** — PASS (expected 2)
- Author **Ada Lovelace** present in delta output: **PASS**

Result: **PASS** — --compare delta output matches inter-tag sentinels.
