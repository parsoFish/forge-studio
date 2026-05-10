#!/usr/bin/env bats

setup() {
  source "$BATS_TEST_DIRNAME/../bash/cmd_apply.sh"
}

@test "--dry-run prints plan and creates no files" {
  cd "$(mktemp -d)"
  echo "manifest content" > input.txt
  run cmd_apply --dry-run input.txt
  [ "$status" -eq 0 ]
  [[ "$output" == *"[DRY-RUN] would create: input.txt.applied"* ]]
  [ ! -f input.txt.applied ]
}

@test "no --dry-run actually creates files" {
  cd "$(mktemp -d)"
  echo "manifest content" > input.txt
  run cmd_apply input.txt
  [ "$status" -eq 0 ]
  [ -f input.txt.applied ]
}
