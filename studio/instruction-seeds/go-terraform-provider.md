---
id: go-terraform-provider
title: Go Terraform-provider conventions
kind: domain
appliesTo: [go, terraform-provider, terraform]
scope: project
provenance: "projects/terraform-provider-betterado/AGENTS.md (proven across the betterado SDKv2→plugin-framework migration + release-pipeline cycles; see brain/projects/betterado/themes)"
---

## Go Terraform-provider conventions

Proven building a real Azure DevOps Terraform provider (SDKv2 muxed with
terraform-plugin-framework) across multiple forge migration cycles.

### Implementation pattern
- `resource_<name>.go` → `*schema.Resource` (SDK v2), CRUD methods with a
  `Context` suffix; `resource_<name>_framework.go` → `resource.Resource`
  (terraform-plugin-framework) for newer resources.
- `expand*` functions map Terraform state → API struct; `flatten*` map API
  struct → state. Every nested layer gets its own expand/flatten pair.
- Register resources in `provider.go`; add HCL examples under `examples/`;
  acceptance tests live under `internal/acceptancetests/`.

### Build / test / lint — exact commands
- **Test only the package you changed**, never the whole tree (a full
  `go test ./...` fills the disk): `go test -tags all -count=1 ./path/to/pkg/...`.
- Compile fast to verify it builds: `go build -mod=vendor .`.
- Auto-format before the gate: `make fmt` (gofmt -s -w) + `make terrafmt`.
- `golangci-lint` runs with `--new-from-rev=main` so it targets only changed code.

### Two-gate quality model
1. **CI-equivalent (offline, creds-free):** `make test && golangci-lint run ./... && make terrafmt-check`.
2. **Live acceptance (`TF_ACC=1`):** scope to the specific `TestAcc<Name>`;
   shape = apply → provider read-back → idempotency re-plan
   (`ExpectNonEmptyPlan: false`) → clean destroy. Creds come from a gitignored
   `secrets.env`.

**Never run bare `go test ./...` with live creds unset** — acceptance tests skip
cleanly and return ok, producing a false-pass with no live verification.

### Fixture discipline
Write fixtures with **non-default** values for every field under test, so a
resource that ignores real config is caught.
