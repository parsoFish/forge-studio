---
id: tdd-red-green
title: Test-driven development (red-green-refactor)
kind: practice
appliesTo: [testing, tdd]
scope: both
provenance: "forge's global testing rules (CLAUDE.md: 'TDD preferred: write the failing test first', 80%+ coverage target) + the tdd-workflow skill + the shipped OOTB community skill superpowers-tdd (obra/superpowers) in studio/catalog.yaml"
---

## Test-driven development (red-green-refactor)

A cross-cutting discipline forge applies to non-trivial code.

- **Write the failing test first.** The test must fail before the behaviour
  exists (proves it tests the right thing) and pass only once the behaviour is
  correct. A gate that passes before any iteration is a vacuous pass.
- **Red → green → refactor.** Smallest change to go green, then refactor with the
  test as a safety net.
- **Never edit a test to make it pass.** If a test is wrong, fix the code or
  raise the issue — do not weaken the assertion.
- **Target 80%+ coverage on non-trivial code.** Skip trivial glue; cover the
  logic that can actually break.
- **One command proves soundness.** Keep a single deterministic, creds-free test
  command as the per-iteration quality gate.
