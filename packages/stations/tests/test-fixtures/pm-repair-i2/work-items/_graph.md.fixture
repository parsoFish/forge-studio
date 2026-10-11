# Work-item dependency graph — INIT-2026-10-11-i2-apply-engine-terraform-retired

```mermaid
graph TD
    WI1["WI-1: Python package scaffold"]
    WI2["WI-2: GitHub App auth module"]
    WI3["WI-3: JSON schemas + seed configs + fixture"]
    WI4["WI-4: Config loading + validation"]
    WI5a["WI-5a: Org settings manager"]
    WI5b["WI-5b: Prefixed resource managers"]
    WI6["WI-6: Plan engine"]
    WI7["WI-7: Apply + reset engines"]
    WI8["WI-8: CLI full wiring"]
    WI9a["WI-9a: TF retirement + bootstrap + CI"]
    WI9b["WI-9b: gw-native team tests"]
    WI10["WI-10: Apply workflow rewrite"]
    WI11["WI-11: Docs cleanup"]
    WI12["WI-12: Acceptance tests"]

    WI1 --> WI2
    WI1 --> WI4
    WI3 --> WI4
    WI2 --> WI5a
    WI4 --> WI5a
    WI5a --> WI5b
    WI4 --> WI6
    WI5b --> WI6
    WI5b --> WI7
    WI6 --> WI8
    WI7 --> WI8
    WI1 --> WI9a
    WI8 --> WI9b
    WI3 --> WI9b
    WI9a --> WI9b
    WI9a --> WI10
    WI8 --> WI12
```

## Wave analysis

| Wave | WIs (parallel) | Unblocked by |
|------|----------------|-------------|
| 0 | WI-1, WI-3, WI-11 | — (independent) |
| 1 | WI-2, WI-9a | WI-1 |
| 2 | WI-4 | WI-1 + WI-3 |
| 3 | WI-5a, WI-10 | WI-2+WI-4 / WI-9a |
| 4 | WI-5b | WI-5a |
| 5 | WI-6, WI-7 | WI-5b (+WI-4 for WI-6) |
| 6 | WI-8 | WI-6 + WI-7 |
| 7 | WI-9b, WI-12 | WI-8 + WI-3 + WI-9a |
