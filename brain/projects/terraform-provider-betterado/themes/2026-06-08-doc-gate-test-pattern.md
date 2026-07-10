---
title: doc-gate-test-pattern — Go test that gates on doc file existence + line count
description: A Go unit test asserting a doc file exists and has ≥N non-empty lines is a cheap, durable gate for doc-only WIs; runs without TF_ACC in the standard test suite.
category: pattern
created_at: 2026-06-08T00:00:00.000Z
updated_at: 2026-06-08T00:00:00.000Z
---

## Pattern

For a doc-only work item (e.g. write a gap matrix, write a roadmap), the quality gate is:

```go
func TestAuditGapMatrixDocExists(t *testing.T) {
    _, filename, _, _ := runtime.Caller(0)
    repoRoot := filepath.Join(filepath.Dir(filename), "..", "..", "..", "..", "..")
    docPath := filepath.Join(repoRoot, "docs", "release-definition-gap-matrix.md")
    content, err := os.ReadFile(docPath)
    if err != nil {
        t.Fatalf("gap matrix doc missing: %v", err)
    }
    lines := strings.Split(string(content), "\n")
    nonEmpty := 0
    for _, l := range lines {
        if strings.TrimSpace(l) != "" {
            nonEmpty++
        }
    }
    if nonEmpty < 50 {
        t.Fatalf("gap matrix has only %d non-empty lines, expected ≥50", nonEmpty)
    }
}
```

Properties:
- No `TF_ACC` required — runs in `make test` / `go test ./...`
- Uses `runtime.Caller(0)` to locate repo root regardless of cwd
- Minimum line-count threshold rules out empty placeholder files
- Multiple tests can share one `doc_audit_test.go` file, one per doc

## Confirmed by

WI-1 and WI-2 of the schema audit initiative: `TestAuditGapMatrixDocExists` and `TestAuditRoadmapDocExists` both gated on their respective docs. Both passed cleanly. Gate-tightener correctly rejected iter-0 for WI-2 (`[no tests to run]` before the test was written) and accepted iter-1.

## Sources

- `_logs/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit/events.jsonl` (lines 107–109, 163: gate.pass events for WI-1 and WI-2)
- `/home/parso/forge/brain/cycles/_raw/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit.md`
