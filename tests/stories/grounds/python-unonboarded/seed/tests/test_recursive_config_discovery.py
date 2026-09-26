"""
Tests for recursive YAML discovery in apply-overlays.py and generate-update-pr.py.

These tests drive the specification for replacing the flat glob
(config/repos/*.yaml) with Path.rglob('*.yaml') in both scripts so that
overlay configs at any subdirectory depth are discovered.  This enables the
team/tier subdirectory conventions.

All tests are in the TDD red phase — they FAIL against the current flat
implementations and will pass once recursive discovery is implemented.

Unit tests — load_overlay_configs (apply-overlays.py):
  - Files at depth 1 (config_dir/repo.yaml) are discovered
  - Files at depth 2 (config_dir/team/repo.yaml) are discovered
  - Files at depth 3 (config_dir/tier/team/repo.yaml) are discovered
  - All three depths are discovered together when mixed in one tree
  - Non-YAML files (.yml, .json, .txt, .md) are excluded at all depths
  - An empty directory returns an empty list without error
  - A directory that does not exist returns an empty list without error

Unit tests — find_consumers (generate-update-pr.py):
  - Consumers at depth 1 are found
  - Consumers at depth 2 are found
  - Consumers at depth 3 are found
  - All three depths returned together when mixed in one tree
  - Non-YAML files at any depth are not treated as consumers
  - Empty directory returns an empty list without error

Integration test — apply-overlays.py --dry-run against scale fixtures:
  - 100 YAML overlay files spread across three subdirectory depths all appear
    in the dry-run output
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest

import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APPLY_OVERLAYS_SCRIPT = os.path.join(REPO_ROOT, "scripts", "apply-overlays.py")
GENERATE_PR_SCRIPT = os.path.join(REPO_ROOT, "scripts", "generate-update-pr.py")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_apply_overlays():
    """Import apply-overlays.py for unit testing its public functions."""
    if not os.path.isfile(APPLY_OVERLAYS_SCRIPT):
        raise FileNotFoundError(
            f"scripts/apply-overlays.py not found at {APPLY_OVERLAYS_SCRIPT}"
        )
    spec = importlib.util.spec_from_file_location("apply_overlays", APPLY_OVERLAYS_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_generate_pr():
    """Import generate-update-pr.py for unit testing its public functions."""
    if not os.path.isfile(GENERATE_PR_SCRIPT):
        raise FileNotFoundError(
            f"scripts/generate-update-pr.py not found at {GENERATE_PR_SCRIPT}"
        )
    spec = importlib.util.spec_from_file_location("generate_update_pr", GENERATE_PR_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _overlay_doc(repo: str, modules: list[str] | None = None) -> dict:
    """Return a minimal valid RepositoryOverlay document."""
    doc: dict = {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {"name": repo.split("/")[-1]},
        "spec": {"repository": repo},
    }
    if modules:
        doc["spec"]["modules"] = [{"name": m} for m in modules]
    return doc


def _write_yaml(path: str, doc: dict) -> None:
    """Write doc as YAML to the given path, creating parent dirs as needed."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(doc, f, default_flow_style=False)


def _run_apply_overlays(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    """Invoke apply-overlays.py with the given arguments; never raises."""
    run_env = os.environ.copy()
    if env:
        run_env.update(env)
    return subprocess.run(
        [sys.executable, APPLY_OVERLAYS_SCRIPT, *args],
        capture_output=True,
        text=True,
        env=run_env,
    )


# ---------------------------------------------------------------------------
# Unit tests: load_overlay_configs — recursive discovery
# ---------------------------------------------------------------------------


class TestLoadOverlayConfigsRecursiveDiscovery(unittest.TestCase):
    """
    load_overlay_configs must discover .yaml files at any subdirectory depth,
    not just the immediate children of config_dir.

    The current implementation uses os.listdir() (depth-1 only).  All tests
    that exercise depth > 1 will FAIL until Path.rglob is used.
    """

    def setUp(self):
        self.mod = _load_apply_overlays()

    def test_discovers_yaml_at_depth_1(self):
        """Files directly in config_dir (depth 1) must be loaded."""
        with tempfile.TemporaryDirectory() as root:
            _write_yaml(
                os.path.join(root, "app-root.yaml"),
                _overlay_doc("org/app-root"),
            )
            result = self.mod.load_overlay_configs(root)
        self.assertEqual(
            len(result),
            1,
            f"Expected 1 config from depth-1 file, got {len(result)}: {result}",
        )
        repos = [r.get("spec", {}).get("repository") for r in result]
        self.assertIn(
            "org/app-root",
            repos,
            f"Expected 'org/app-root' in discovered repos: {repos}",
        )

    def test_discovers_yaml_at_depth_2(self):
        """Files one subdirectory deep (depth 2) must be loaded."""
        with tempfile.TemporaryDirectory() as root:
            _write_yaml(
                os.path.join(root, "team-alpha", "app-alpha.yaml"),
                _overlay_doc("org/app-alpha"),
            )
            result = self.mod.load_overlay_configs(root)
        self.assertEqual(
            len(result),
            1,
            f"Expected 1 config from depth-2 file, got {len(result)}: {result}",
        )
        repos = [r.get("spec", {}).get("repository") for r in result]
        self.assertIn(
            "org/app-alpha",
            repos,
            f"Expected 'org/app-alpha' in discovered repos at depth 2: {repos}",
        )

    def test_discovers_yaml_at_depth_3(self):
        """Files two subdirectories deep (depth 3) must be loaded."""
        with tempfile.TemporaryDirectory() as root:
            _write_yaml(
                os.path.join(root, "tier-prod", "team-alpha", "app-deep.yaml"),
                _overlay_doc("org/app-deep"),
            )
            result = self.mod.load_overlay_configs(root)
        self.assertEqual(
            len(result),
            1,
            f"Expected 1 config from depth-3 file, got {len(result)}: {result}",
        )
        repos = [r.get("spec", {}).get("repository") for r in result]
        self.assertIn(
            "org/app-deep",
            repos,
            f"Expected 'org/app-deep' in discovered repos at depth 3: {repos}",
        )

    def test_discovers_files_at_all_three_depths_together(self):
        """A tree with files at depths 1, 2, and 3 must yield all three configs."""
        with tempfile.TemporaryDirectory() as root:
            _write_yaml(
                os.path.join(root, "app-root.yaml"),
                _overlay_doc("org/app-root"),
            )
            _write_yaml(
                os.path.join(root, "team-alpha", "app-alpha.yaml"),
                _overlay_doc("org/app-alpha"),
            )
            _write_yaml(
                os.path.join(root, "tier-prod", "team-beta", "app-deep.yaml"),
                _overlay_doc("org/app-deep"),
            )
            result = self.mod.load_overlay_configs(root)

        self.assertEqual(
            len(result),
            3,
            f"Expected 3 configs from depth-1/2/3 tree, got {len(result)}: {result}",
        )
        repos = {r.get("spec", {}).get("repository") for r in result}
        for expected_repo in ("org/app-root", "org/app-alpha", "org/app-deep"):
            self.assertIn(
                expected_repo,
                repos,
                f"Repo '{expected_repo}' not found in discovered set: {repos}",
            )

    def test_excludes_non_yaml_files_at_depth_2(self):
        """
        Non-.yaml files (.yml, .json, .txt) inside subdirectories must be
        ignored even when they contain valid YAML content.
        """
        with tempfile.TemporaryDirectory() as root:
            subdir = os.path.join(root, "team-alpha")
            os.makedirs(subdir)
            # Write a valid overlay as .yml — must be excluded
            with open(os.path.join(subdir, "app.yml"), "w") as f:
                yaml.dump(_overlay_doc("org/app-yml"), f)
            # Write a valid overlay as .json — must be excluded
            with open(os.path.join(subdir, "app.json"), "w") as f:
                f.write('{"apiVersion": "gitweave.io/v1"}')
            # Write a plain text file — must be excluded
            with open(os.path.join(subdir, "README.txt"), "w") as f:
                f.write("documentation\n")
            result = self.mod.load_overlay_configs(root)

        self.assertEqual(
            result,
            [],
            f"Non-.yaml files must be excluded; got {result}",
        )

    def test_excludes_non_yaml_files_at_depth_3(self):
        """Non-.yaml files nested three levels deep must not be loaded."""
        with tempfile.TemporaryDirectory() as root:
            deep = os.path.join(root, "tier-prod", "team-alpha")
            os.makedirs(deep)
            with open(os.path.join(deep, "notes.md"), "w") as f:
                f.write("# notes\n")
            with open(os.path.join(deep, "data.yml"), "w") as f:
                yaml.dump(_overlay_doc("org/app-yml"), f)
            result = self.mod.load_overlay_configs(root)

        self.assertEqual(
            result,
            [],
            f"Non-.yaml files at depth 3 must be excluded; got {result}",
        )

    def test_empty_directory_returns_empty_list_without_error(self):
        """An empty config_dir must return [] without raising any exception."""
        with tempfile.TemporaryDirectory() as root:
            result = self.mod.load_overlay_configs(root)
        self.assertEqual(
            result,
            [],
            f"Empty directory must return [], got {result}",
        )

    def test_nonexistent_directory_returns_empty_list_without_error(self):
        """A config_dir that does not exist must return [] without error."""
        result = self.mod.load_overlay_configs("/nonexistent/path/config/repos")
        self.assertEqual(
            result,
            [],
            f"Nonexistent directory must return [], got {result}",
        )

    def test_subdirectory_with_only_non_yaml_files_does_not_count(self):
        """
        A subdirectory containing only .yml files at depth 2 must produce
        zero configs — .yml is not .yaml.
        """
        with tempfile.TemporaryDirectory() as root:
            subdir = os.path.join(root, "team-alpha")
            os.makedirs(subdir)
            with open(os.path.join(subdir, "app.yml"), "w") as f:
                yaml.dump(_overlay_doc("org/app"), f)
            result = self.mod.load_overlay_configs(root)
        self.assertEqual(
            len(result),
            0,
            f".yml files must not be counted as .yaml; got {result}",
        )

    def test_mixed_depth_tree_excludes_non_yaml_and_includes_yaml(self):
        """
        In a tree with both .yaml and non-yaml files at multiple depths,
        only .yaml files at any depth must be returned.
        """
        with tempfile.TemporaryDirectory() as root:
            # depth 1: one YAML, one non-YAML
            _write_yaml(os.path.join(root, "root.yaml"), _overlay_doc("org/root"))
            with open(os.path.join(root, "root.yml"), "w") as f:
                yaml.dump(_overlay_doc("org/root-yml"), f)

            # depth 2: one YAML, one non-YAML
            _write_yaml(
                os.path.join(root, "team-a", "app-a.yaml"),
                _overlay_doc("org/app-a"),
            )
            with open(os.path.join(os.path.join(root, "team-a"), "app-a.yml"), "w") as f:
                yaml.dump(_overlay_doc("org/app-a-yml"), f)

            result = self.mod.load_overlay_configs(root)

        repos = {r.get("spec", {}).get("repository") for r in result}
        self.assertEqual(
            len(result),
            2,
            f"Expected exactly 2 .yaml files; got {len(result)}: {repos}",
        )
        self.assertIn("org/root", repos)
        self.assertIn("org/app-a", repos)
        self.assertNotIn("org/root-yml", repos)
        self.assertNotIn("org/app-a-yml", repos)


# ---------------------------------------------------------------------------
# Unit tests: find_consumers — recursive discovery
# ---------------------------------------------------------------------------


class TestFindConsumersRecursiveDiscovery(unittest.TestCase):
    """
    find_consumers must scan YAML files at any subdirectory depth, not just
    the immediate children of config_dir.

    The current implementation uses glob.glob('config_dir/*.yaml') (depth-1
    only).  All depth > 1 tests will FAIL until recursive rglob is used.
    """

    def setUp(self):
        self.mod = _load_generate_pr()

    def _write_consumer(self, config_dir: str, rel_path: str, repo: str, modules: list[str]) -> None:
        """Write a consumer overlay YAML relative to config_dir."""
        full_path = os.path.join(config_dir, rel_path)
        _write_yaml(full_path, _overlay_doc(repo, modules))

    def test_finds_consumer_at_depth_1(self):
        """A consumer YAML in config_dir directly (depth 1) must be found."""
        with tempfile.TemporaryDirectory() as root:
            self._write_consumer(root, "app-root.yaml", "org/app-root", ["python-service"])
            result = self.mod.find_consumers("python-service", config_dir=root)
        self.assertIn(
            "org/app-root",
            result,
            f"Consumer at depth 1 must be discovered; got {result}",
        )

    def test_finds_consumer_at_depth_2(self):
        """A consumer YAML one subdirectory deep (depth 2) must be found."""
        with tempfile.TemporaryDirectory() as root:
            self._write_consumer(
                root, "team-alpha/app-alpha.yaml", "org/app-alpha", ["python-service"]
            )
            result = self.mod.find_consumers("python-service", config_dir=root)
        self.assertIn(
            "org/app-alpha",
            result,
            f"Consumer at depth 2 must be discovered; got {result}",
        )

    def test_finds_consumer_at_depth_3(self):
        """A consumer YAML two subdirectories deep (depth 3) must be found."""
        with tempfile.TemporaryDirectory() as root:
            self._write_consumer(
                root,
                "tier-prod/team-alpha/app-deep.yaml",
                "org/app-deep",
                ["python-service"],
            )
            result = self.mod.find_consumers("python-service", config_dir=root)
        self.assertIn(
            "org/app-deep",
            result,
            f"Consumer at depth 3 must be discovered; got {result}",
        )

    def test_finds_consumers_at_all_three_depths_together(self):
        """Consumers spread across depths 1, 2, and 3 must all be returned."""
        with tempfile.TemporaryDirectory() as root:
            self._write_consumer(root, "root.yaml", "org/root", ["python-service"])
            self._write_consumer(
                root, "team-alpha/alpha.yaml", "org/alpha", ["python-service"]
            )
            self._write_consumer(
                root,
                "tier-prod/team-beta/beta.yaml",
                "org/beta",
                ["python-service"],
            )
            result = self.mod.find_consumers("python-service", config_dir=root)

        self.assertEqual(
            len(result),
            3,
            f"Expected 3 consumers from depth-1/2/3 tree, got {len(result)}: {result}",
        )
        for expected in ("org/root", "org/alpha", "org/beta"):
            self.assertIn(
                expected,
                result,
                f"Consumer '{expected}' must appear in results: {result}",
            )

    def test_non_consumer_at_depth_2_not_returned(self):
        """
        A repo at depth 2 that uses OTHER modules (not the updated one) must
        not appear in the consumer list.
        """
        with tempfile.TemporaryDirectory() as root:
            self._write_consumer(
                root, "team-alpha/app-other.yaml", "org/app-other", ["terraform-module"]
            )
            result = self.mod.find_consumers("python-service", config_dir=root)
        self.assertNotIn(
            "org/app-other",
            result,
            f"Non-consumer at depth 2 must not be returned: {result}",
        )

    def test_non_yaml_files_at_depth_2_not_treated_as_consumers(self):
        """
        .yml files inside subdirectories must not be scanned as consumer
        configs; only .yaml files count.
        """
        with tempfile.TemporaryDirectory() as root:
            subdir = os.path.join(root, "team-alpha")
            os.makedirs(subdir)
            # Write valid overlay as .yml — must be ignored
            with open(os.path.join(subdir, "app.yml"), "w") as f:
                yaml.dump(_overlay_doc("org/app-yml", ["python-service"]), f)
            result = self.mod.find_consumers("python-service", config_dir=root)
        self.assertEqual(
            result,
            [],
            f".yml files in subdirs must not be scanned; got {result}",
        )

    def test_empty_config_dir_returns_empty_list_without_error(self):
        """An empty config_dir must return [] without raising any exception."""
        with tempfile.TemporaryDirectory() as root:
            result = self.mod.find_consumers("python-service", config_dir=root)
        self.assertEqual(result, [], f"Empty config dir must return [], got {result}")

    def test_only_subdirectory_with_no_yaml_files_returns_empty_list(self):
        """
        A config_dir containing only empty subdirectories (no .yaml files)
        must return [] without error.
        """
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "team-alpha", "team-beta"))
            result = self.mod.find_consumers("python-service", config_dir=root)
        self.assertEqual(
            result,
            [],
            f"No .yaml files anywhere must return [], got {result}",
        )

    def test_mixed_depth_tree_only_returns_matching_consumers(self):
        """
        In a mixed tree, only repos whose module list includes the target
        module are returned — regardless of which depth they sit at.
        """
        with tempfile.TemporaryDirectory() as root:
            # Matches at depth 1 and depth 3
            self._write_consumer(root, "root.yaml", "org/root", ["python-service"])
            self._write_consumer(
                root, "tier/team/deep.yaml", "org/deep", ["python-service"]
            )
            # Does NOT match at depth 2
            self._write_consumer(
                root, "team-alpha/other.yaml", "org/other", ["terraform-module"]
            )
            result = self.mod.find_consumers("python-service", config_dir=root)

        self.assertEqual(
            len(result),
            2,
            f"Expected exactly 2 matching consumers, got {len(result)}: {result}",
        )
        self.assertIn("org/root", result)
        self.assertIn("org/deep", result)
        self.assertNotIn("org/other", result)


# ---------------------------------------------------------------------------
# Integration test: --dry-run against 100-file scale fixtures
# ---------------------------------------------------------------------------


class TestScaleFixturesDryRun(unittest.TestCase):
    """
    Integration test: apply-overlays.py --dry-run must output all repos from
    a config tree containing 100 .yaml overlay files spread across three
    subdirectory depths.

    This test FAILS until load_overlay_configs uses recursive discovery because
    the current implementation only finds files in the top-level directory.
    """

    _TOTAL_FILES = 100
    _DEPTH_1_COUNT = 34   # config_dir/repo-N.yaml
    _DEPTH_2_COUNT = 33   # config_dir/team-X/repo-N.yaml
    _DEPTH_3_COUNT = 33   # config_dir/tier-Y/team-Z/repo-N.yaml

    def _build_scale_fixtures(self, root: str) -> list[str]:
        """
        Create _TOTAL_FILES overlay YAML files distributed across three depths.
        Returns the list of expected repo slugs.
        """
        repos: list[str] = []
        idx = 0

        # Depth 1
        for i in range(self._DEPTH_1_COUNT):
            repo = f"scale-org/repo-d1-{i:04d}"
            path = os.path.join(root, f"repo-d1-{i:04d}.yaml")
            _write_yaml(path, _overlay_doc(repo, ["lang-node"]))
            repos.append(repo)
            idx += 1

        # Depth 2 — spread across 3 team directories
        teams = ["team-alpha", "team-beta", "team-gamma"]
        for i in range(self._DEPTH_2_COUNT):
            team = teams[i % len(teams)]
            repo = f"scale-org/repo-d2-{i:04d}"
            path = os.path.join(root, team, f"repo-d2-{i:04d}.yaml")
            _write_yaml(path, _overlay_doc(repo, ["lang-python"]))
            repos.append(repo)
            idx += 1

        # Depth 3 — spread across tier/team combos
        tiers = ["tier-prod", "tier-staging"]
        for i in range(self._DEPTH_3_COUNT):
            tier = tiers[i % len(tiers)]
            team = teams[i % len(teams)]
            repo = f"scale-org/repo-d3-{i:04d}"
            path = os.path.join(root, tier, team, f"repo-d3-{i:04d}.yaml")
            _write_yaml(path, _overlay_doc(repo, ["terraform-module"]))
            repos.append(repo)
            idx += 1

        return repos

    def test_all_100_scale_fixtures_appear_in_dry_run_output(self):
        """
        --dry-run output must mention all 100 repo slugs from a config tree
        with files at depths 1, 2, and 3.

        Fails until load_overlay_configs uses Path.rglob (recursive).
        """
        with tempfile.TemporaryDirectory() as config_root:
            expected_repos = self._build_scale_fixtures(config_root)

            self.assertEqual(
                len(expected_repos),
                self._TOTAL_FILES,
                f"Fixture builder must produce exactly {self._TOTAL_FILES} repos",
            )

            result = _run_apply_overlays(
                "--dry-run",
                "--config-dir", config_root,
            )

        self.assertEqual(
            result.returncode,
            0,
            f"Script must exit 0 in dry-run with scale fixtures.\n"
            f"stdout: {result.stdout[:500]}\nstderr: {result.stderr[:500]}",
        )

        combined = result.stdout + result.stderr
        missing = [repo for repo in expected_repos if repo not in combined]
        self.assertEqual(
            missing,
            [],
            f"{len(missing)} of {self._TOTAL_FILES} repo slugs missing from dry-run output.\n"
            f"First 5 missing: {missing[:5]}\n"
            f"stdout (first 1000 chars): {result.stdout[:1000]}",
        )

    def test_scale_fixtures_at_depth_2_only_all_appear_in_dry_run(self):
        """
        When the config tree contains only depth-2 files, all must appear
        in dry-run output.  Isolated from depth-1/3 noise.
        """
        with tempfile.TemporaryDirectory() as config_root:
            expected_repos = []
            for i in range(20):
                team = f"team-{i % 4}"
                repo = f"scale-org/d2-only-{i:04d}"
                path = os.path.join(config_root, team, f"app-{i:04d}.yaml")
                _write_yaml(path, _overlay_doc(repo, ["lang-node"]))
                expected_repos.append(repo)

            result = _run_apply_overlays(
                "--dry-run",
                "--config-dir", config_root,
            )

        combined = result.stdout + result.stderr
        missing = [repo for repo in expected_repos if repo not in combined]
        self.assertEqual(
            missing,
            [],
            f"{len(missing)} depth-2 repos missing from dry-run output.\n"
            f"First 5 missing: {missing[:5]}\n"
            f"stdout: {result.stdout[:800]}",
        )

    def test_scale_fixtures_at_depth_3_only_all_appear_in_dry_run(self):
        """
        When the config tree contains only depth-3 files, all must appear
        in dry-run output.  Isolated from depth-1/2 noise.
        """
        with tempfile.TemporaryDirectory() as config_root:
            expected_repos = []
            for i in range(20):
                tier = f"tier-{i % 2}"
                team = f"team-{i % 3}"
                repo = f"scale-org/d3-only-{i:04d}"
                path = os.path.join(config_root, tier, team, f"app-{i:04d}.yaml")
                _write_yaml(path, _overlay_doc(repo, ["lang-python"]))
                expected_repos.append(repo)

            result = _run_apply_overlays(
                "--dry-run",
                "--config-dir", config_root,
            )

        combined = result.stdout + result.stderr
        missing = [repo for repo in expected_repos if repo not in combined]
        self.assertEqual(
            missing,
            [],
            f"{len(missing)} depth-3 repos missing from dry-run output.\n"
            f"First 5 missing: {missing[:5]}\n"
            f"stdout: {result.stdout[:800]}",
        )


if __name__ == "__main__":
    unittest.main()
