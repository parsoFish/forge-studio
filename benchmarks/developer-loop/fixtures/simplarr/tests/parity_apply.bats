#!/usr/bin/env bats
# Pre-existing parity test — must not regress when WI-1 lands.

@test "bash apply prints the apply banner" {
  run bash bash/simplarr.sh apply
  [ "$status" -eq 0 ]
  [[ "$output" == *"applying"* ]]
}
