---
work_item_id: WI-1
feature_id: FEAT-1
initiative_id: INIT-2026-05-09-gitweave-multipart-stub
status: pending
depends_on: []
acceptance_criteria:
  - given: "a multipart-style body string and a boundary marker"
    when:  "splitOnBoundary(body, boundary) is called"
    then:  "an array of parts (between consecutive boundary markers) is returned"
  - given: "a body with no boundary markers"
    when:  "splitOnBoundary is called"
    then:  "an empty array is returned (not an array containing the body)"
  - given: "a body whose final marker is the closing form (`--<boundary>--`)"
    when:  "splitOnBoundary is called"
    then:  "the closing marker is treated as the terminator (its trailing content is not a part)"
files_in_scope:
  - src/multipart.ts
estimated_iterations: 2
---

# Add `splitOnBoundary` helper in a new src/multipart.ts module

Multipart-body parsing is needed by an upcoming PR-comment ingest feature. Land the smallest splitter helper now: a pure function that splits a body string on a boundary marker into its individual parts.

## Function signature

```ts
export function splitOnBoundary(body: string, boundary: string): string[];
```

Boundary markers in the body look like `--<boundary>` (start/separator) and `--<boundary>--` (terminator). Each part is the content between two markers, with leading/trailing newlines trimmed. The closing marker (`--<boundary>--`) ends the multipart sequence; content after it is not a part.

## Failing test

`tests/multipart.test.ts` already exists and currently fails because `src/multipart.ts` does not exist. **Create `src/multipart.ts` with the `splitOnBoundary` export and make the tests pass.** Do not modify the test file.

## Hard rules

- Single new file: `src/multipart.ts`. Pure function — no I/O, no side effects.
- Pre-existing tests (`tests/runner.test.ts`) must keep passing.
- TypeScript strict mode applies; no implicit `any`.

## Brain themes worth a look

- `regex-vs-llm-structured-text` — multipart bodies have a regular structure; regex is appropriate, an LLM is not.
