# Send-back feedback

Close — but the --compact + --format json error must name BOTH flags before this merges.

## Acceptance criteria to address this round

- GIVEN a cycle dir and the flags --compact --format json WHEN claude-trail is run THEN it exits non-zero and stderr names both --compact and json
