---
title: 'Go / Terraform build & tooling discipline'
description: 'Topical index — Go module/vendor/build and Terraform tooling traps: go internal-package import, vendor-before-tidy, tfplugindocs typename, terrafmt coverage gaps, make docs/test traps, python brace tracer, unused-func lint gaps.'
category: reference
keywords: [build, tooling, index, topical-hub]
related_themes: [provider-registration-dedup-index, framework-migration-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Go module/vendor/build and Terraform tooling traps: go internal-package import, vendor-before-tidy, tfplugindocs typename, terrafmt coverage gaps, make docs/test traps, python brace tracer, unused-func lint gaps.

## Member themes (15)

- [[2026-06-11-vendor-unmarshal-patch-for-ado-enum-int]] — ADO returns daysToRelease as a JSON integer bitmask but the Go SDK declares ScheduleDays as a string enum. Raw vendor edit was the initial fix; now formalized as a tracked third_party/ fork with go.mod replace — survives go mod vendor regeneration.
- [[2026-06-18-make-test-hangs-offline-unguarded-acc-tests]] — The GNUmakefile `test` target runs `go test -v ./...`, which includes acceptancetests/. At least two upstream tests lack a TF_ACC build-tag guard and attempt live ADO calls offline, causing multi-minute hangs. Use package-scoped commands for offline CI verification.
- [[2026-06-18-terrafmt-check-does-not-cover-examples-dir]] — make terrafmt-check targets ./azuredevops/**/*_test.go only; HCL in examples/resources/ and docs/resources/ is not validated by CI or the per-WI quality gate.
- [[2026-06-18-terrafmt-omitted-from-agent-offline-gate-chain]] — The ralph dev-loop agent's ad-hoc offline pre-gate check chain (go build, go vet, gofmt -l) consistently omits ./scripts/terrafmt.sh; terrafmt failures in HCL blocks inside acceptance test files are caught at gate time or at the CI gate, not by the agent's own pass.
- [[2026-06-19-go-internal-package-main-cannot-import]] — The root main.go (module root) cannot import azuredevops/internal/provider because Go's internal/ rule restricts importers to the subtree rooted at the parent of internal/. Fix is a thin public re-export in azuredevops/framework.go.
- [[2026-06-19-go-module-vendor-write-code-before-tidy]] — In vendor-mode Go modules, running go mod tidy before writing the importing code drops the new deps; the correct order is write code → go get → go mod tidy → go mod vendor.
- [[2026-06-19-plugin-go-sdk-interface-compat]] — terraform-plugin-go@v0.31.0 added GenerateResourceConfig to tfprotov5.ProviderServer; terraform-plugin-sdk/v2@v2.38.1 doesn't implement it, causing a build failure. Bump sdk/v2 to v2.40.1+ to resolve.
- [[2026-06-20-framework-provider-typename-must-be-betterado]] — BetteradoFrameworkProvider.Metadata() must set TypeName = "betterado"; "azuredevops" causes tfplugindocs to emit wrong-prefixed resource docs.
- [[2026-06-20-make-docs-deletes-guides-dir]] — tfplugindocs generate wipes the entire docs/ tree including hand-written guides; git checkout -- docs/guides/ required after every docs run.
- [[2026-06-20-python3-brace-tracer-for-large-go-file]] — When resource_release_definition_framework.go exceeded ~600 lines, ralph resorted to inline python3 brace-depth scripts to locate struct/function closure points; normal Read/Edit pattern produced misplaced insertions.
- [[2026-06-20-tfplugindocs-typename-must-match-provider-prefix]] — framework_provider.go Metadata() must return TypeName matching the re-branded provider name; wrong value produces double-prefixed resource names and fails make docs.
- [[2026-07-01-dead-sdkv2-publisher-funcs-block-ci-gate-twice]] — >-
- [[2026-07-05-unused-func-lint-gate-gap-extension-install]] — expandExtensionInstall left unused in resource_extension_install_framework.go; go test passed per-WI gate but golangci-lint caught it at CI gate, blocking PR — same gate-gap pattern as 2026-06-06.
- [[2026-07-05-unused-hcl-helpers-after-test-rewrite]] — When acceptance tests are rewritten to use the import path instead of create path, the original HCL helper functions (e.g. hclTeamBasic) become unreachable; golangci-lint unused check blocks CI gate at the end.
- [[2026-07-10-operator-dead-code-sweep-post-roadmap]] — After the 24-initiative roadmap merged to 2.0.0, 113 orphaned SDKv2 files and a bloated commons.go required a manual operator sweep the dev-loop fleet couldn't execute due to weekly usage limits; no dev-loop iteration ever cleaned the entire package in one pass.

## See also

- [[provider-registration-dedup-index]] — Provider registration & dedup discipline.
- [[framework-migration-index]] — Framework migration (SDKv2 → plugin-framework).
