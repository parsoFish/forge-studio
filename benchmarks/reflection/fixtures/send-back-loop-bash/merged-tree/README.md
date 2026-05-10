# simplarr — `--dry-run` flag

Merged sample tree for the reflection bench fixture `send-back-loop-bash`.

The `apply` command supports `--dry-run` which prints a preview of file
operations to stdout and exits without touching the filesystem.

```bash
simplarr apply --dry-run path/to/manifest
```

See `bash/cmd_apply.sh` and `tests/dry_run.bats`.
