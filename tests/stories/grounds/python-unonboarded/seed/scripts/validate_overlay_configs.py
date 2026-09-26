#!/usr/bin/env python3
"""Validate GitWeave overlay YAML files against schemas/overlay.schema.json.

Usage:
  # Directory mode — validate all .yaml files in a directory:
  python scripts/validate_overlay_configs.py config/repos/

  # File-path mode — validate specific files (incremental PR validation):
  python scripts/validate_overlay_configs.py config/repos/a.yaml config/repos/b.yaml

  # No-argument mode — nothing to validate (empty PR diff):
  python scripts/validate_overlay_configs.py

Exits 0 if all files pass schema validation, non-zero if any fail.
"""

import concurrent.futures
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml
import jsonschema
from jsonschema import validate, ValidationError

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_SCHEMA_PATH = os.path.join(REPO_ROOT, "schemas", "overlay.schema.json")


def load_schema(schema_path: str) -> dict:
    with open(schema_path) as f:
        return json.load(f)


def _validate_file(filepath: str, schema: dict) -> tuple[str, bool, str]:
    """Validate a single YAML file. Returns (filename, ok, message)."""
    filename = os.path.basename(filepath)
    try:
        with open(filepath) as f:
            doc = yaml.safe_load(f)
    except yaml.YAMLError as exc:
        return filename, False, f"YAML parse error — {exc}"

    try:
        validate(instance=doc, schema=schema)
        return filename, True, ""
    except ValidationError as exc:
        return filename, False, exc.message


def validate_files(filepaths: list[str], schema: dict) -> bool:
    """Validate a list of YAML file paths in parallel. Returns True if all pass."""
    if not filepaths:
        print("Validated 0 files")
        return True

    results: list[tuple[str, bool, str]] = [None] * len(filepaths)

    with ThreadPoolExecutor() as executor:
        future_to_index = {
            executor.submit(_validate_file, filepath, schema): i
            for i, filepath in enumerate(filepaths)
        }
        for future in concurrent.futures.as_completed(future_to_index):
            idx = future_to_index[future]
            results[idx] = future.result()

    failures = []
    for filename, ok, message in results:
        if ok:
            print(f"OK   {filename}")
        else:
            print(f"FAIL {filename}: {message}")
            failures.append(filename)

    file_word = "file" if len(filepaths) == 1 else "files"
    print(f"Validated {len(filepaths)} {file_word}")

    if failures:
        print(f"{len(failures)} file(s) failed validation: {', '.join(failures)}")
        return False

    return True


def validate_directory(config_dir: str, schema: dict) -> bool:
    """Validate all .yaml files in config_dir in parallel. Returns True if all pass."""
    if not os.path.isdir(config_dir):
        print(f"Validated 0 files (directory does not exist: {config_dir})")
        return True

    yaml_files = sorted(
        os.path.join(config_dir, f)
        for f in os.listdir(config_dir) if f.endswith(".yaml")
    )

    return validate_files(yaml_files, schema)


def main() -> int:
    args = sys.argv[1:]

    schema = load_schema(DEFAULT_SCHEMA_PATH)

    # No arguments — nothing to validate (empty PR diff)
    if not args:
        print("No overlay files to validate — skipping")
        print("Validated 0 files")
        return 0

    # Single argument: directory mode or single file
    if len(args) == 1:
        target = Path(args[0])
        if not target.exists():
            print(f"Validated 0 files (path does not exist: {args[0]})")
            return 0
        if target.is_dir():
            success = validate_directory(str(target), schema)
            return 0 if success else 1
        # Single file
        success = validate_files([str(target)], schema)
        return 0 if success else 1

    # Multiple arguments: file-path mode (incremental PR validation)
    filepaths = [f for f in args if os.path.isfile(f)]
    success = validate_files(filepaths, schema)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
