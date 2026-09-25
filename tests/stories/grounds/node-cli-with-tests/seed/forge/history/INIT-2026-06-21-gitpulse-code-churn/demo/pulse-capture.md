# gitpulse demo evidence

## Command

```
node dist/cli.js <temp-fixture-repo>
```

## Captured output (the real generated report)

```text
gitpulse — 4 commits (2021-03-01 → 2021-03-07)

commits  author
-------  ------
      3  Ada Lovelace
      1  Grace Hopper

churn (lines)  author
-------------  ------
        +3/-0  Ada Lovelace
        +1/-0  Grace Hopper

churn (lines)  file
-------------  ----
        +1/-0  compiler.ts
        +1/-0  engine.ts
        +1/-0  loom.ts
        +1/-0  notes.md
```

## Windowed output (--since 2021-03-02)

```text
gitpulse — 3 commits (2021-03-02 → 2021-03-07)

commits  author
-------  ------
      2  Ada Lovelace
      1  Grace Hopper

churn (lines)  author
-------------  ------
        +2/-0  Ada Lovelace
        +1/-0  Grace Hopper

churn (lines)  file
-------------  ----
        +1/-0  compiler.ts
        +1/-0  loom.ts
        +1/-0  notes.md
```

## Read-back assertion

- Total commits: **4** (four non-merge commits, two authors).
- Top author: **Ada Lovelace** with **3** commits.
- Date range: **2021-03-01 → 2021-03-07** (fixed GIT_AUTHOR_DATE sentinels).
- Top churn file: **compiler.ts** (path tie-break ascending).
- Author churn: **Ada Lovelace** with non-zero insertions.
- Windowed (--since 2021-03-02): **3** commits.

Result: **PASS** — the captured report matches the asserted sentinels.
