---
initiative_id: INIT-2026-05-09-healarr-stub-multipart
project: healarr
project_repo_path: /tmp/healarr
created_at: 2026-05-09T18:00:00Z
iteration_budget: 20
cost_budget_usd: 8
phase: done
features:
  - feature_id: FEAT-1
    title: Stub multipart parser for upload smoke tests
    depends_on: []
---

# Initiative: healarr — multipart stub for smoke tests

The healarr upload endpoint smoke tests need a deterministic multipart
body parser stub: input bytes → array of {name, content} records. Real
parsing lives in a downstream library; this stub covers the smoke-test
surface only.

## Features

### FEAT-1 — `parseMultipartStub(buffer, boundary)`

`src/multipart.ts` exports a single function returning the parsed parts.
Tested in `tests/multipart.test.ts` with three boundary scenarios.
