---
title: terraform-plugin-framework v1.19.0 — default sub-packages not vendored; implement inline
description: stringdefault, booldefault, int64default sub-packages are absent from the vendored terraform-plugin-framework; defaults must be inline structs. Default field also requires Computed true.
category: reference
created_at: "2026-06-20"
updated_at: "2026-06-20"
---

## Pattern

In this repo's vendored terraform-plugin-framework (v1.19.0), the `stringdefault`, `booldefault`, and `int64default` sub-packages under `resource/schema/` are **not present**. Attempting to import them causes a build error.

Workaround: implement the default inline as a struct that satisfies `defaults.String` / `defaults.Bool` / `defaults.Int64`:

```go
type staticStringDefault struct{ v string }

func (d staticStringDefault) Description(_ context.Context) string      { return fmt.Sprintf("defaults to %q", d.v) }
func (d staticStringDefault) MarkdownDescription(_ context.Context) string { return fmt.Sprintf("defaults to %q", d.v) }
func (d staticStringDefault) DefaultString(_ context.Context, _ defaults.StringRequest, resp *defaults.StringResponse) {
    resp.PlanValue = types.StringValue(d.v)
}
```

Also: any attribute with `Default:` set **must** also have `Computed: true`; omitting `Computed` causes a schema validation panic.

`resource.ResourceWithMetadata` does not exist in this version; `Metadata()` is already on the base `resource.Resource` interface.

Both WI-1 pipeline runs (attempt-1 and attempt-3) independently rediscovered these facts via ~15 `find`/`grep` vendor scans each.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` — WI-1 iteration 1 at line 1505 (`tools_used` bash_commands showing vendor discovery); WI-1 attempt-1 iteration 0 at line 422 (same pattern).
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
