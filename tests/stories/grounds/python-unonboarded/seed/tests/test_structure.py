import os
import subprocess
import unittest

import yaml


class TestRepoStructure(unittest.TestCase):
    def setUp(self):
        # Assumes the test is run from the repo root or tests/ directory
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

    # --- FR-001, FR-002, FR-006, FR-008 ---

    def test_root_directories_exist(self):
        """FR-001, FR-002, FR-006, FR-008: Verify core directories exist."""
        required_dirs = [
            'modules',
            'config',
            'infra',
            'metrics',
            '.github/workflows',
        ]
        for d in required_dirs:
            path = os.path.join(self.repo_root, d)
            self.assertTrue(os.path.isdir(path), f"Directory missing: {d}")

    # --- FR-003, FR-005, FR-007 ---

    def test_required_files_exist(self):
        """FR-003, FR-005, FR-007: Verify core files exist."""
        required_files = [
            'README.md',
            '.github/workflows/gitweave-apply.yaml',
            '.github/workflows/gitweave-infra.yaml',
            'infra/main.tf',
            'metrics/src/main.py',
        ]
        for f in required_files:
            path = os.path.join(self.repo_root, f)
            self.assertTrue(os.path.isfile(path), f"File missing: {f}")

    # --- bootstrap.sh ---

    def test_bootstrap_script_exits_zero(self):
        """bootstrap.sh should succeed when all prerequisites (git, terraform, python3) are present."""
        script = os.path.join(self.repo_root, 'scripts', 'bootstrap.sh')
        self.assertTrue(os.path.isfile(script), "scripts/bootstrap.sh is missing")
        result = subprocess.run(
            ['bash', script],
            capture_output=True,
            text=True,
            cwd=self.repo_root,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"bootstrap.sh exited {result.returncode}:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}",
        )

    # --- FR-004: gitweave-apply.yaml YAML validity and trigger paths ---

    def test_gitweave_apply_workflow_is_valid_yaml_and_triggers_on_config(self):
        """FR-004: gitweave-apply.yaml must be valid YAML and trigger on config/** push to main."""
        path = os.path.join(self.repo_root, '.github/workflows/gitweave-apply.yaml')
        with open(path) as f:
            doc = yaml.safe_load(f)

        # Must parse without error — asserted by reaching this line
        self.assertIsInstance(doc, dict, "gitweave-apply.yaml did not parse as a YAML mapping")

        # Must trigger on push to main scoped to config/**
        push_on = doc.get('on', {}).get('push', {})
        self.assertIn('main', push_on.get('branches', []),
                      "gitweave-apply.yaml does not trigger on branch 'main'")
        self.assertIn('config/**', push_on.get('paths', []),
                      "gitweave-apply.yaml does not scope trigger to 'config/**'")

        # Must also support manual dispatch
        self.assertIn('workflow_dispatch', doc.get('on', {}),
                      "gitweave-apply.yaml is missing workflow_dispatch trigger")

    # --- FR-007: gitweave-infra.yaml YAML validity and trigger paths ---

    def test_gitweave_infra_workflow_is_valid_yaml_and_triggers_on_infra(self):
        """FR-007: gitweave-infra.yaml must be valid YAML and trigger on infra/** push to main."""
        path = os.path.join(self.repo_root, '.github/workflows/gitweave-infra.yaml')
        with open(path) as f:
            doc = yaml.safe_load(f)

        self.assertIsInstance(doc, dict, "gitweave-infra.yaml did not parse as a YAML mapping")

        push_on = doc.get('on', {}).get('push', {})
        self.assertIn('main', push_on.get('branches', []),
                      "gitweave-infra.yaml does not trigger on branch 'main'")
        self.assertIn('infra/**', push_on.get('paths', []),
                      "gitweave-infra.yaml does not scope trigger to 'infra/**'")

        self.assertIn('workflow_dispatch', doc.get('on', {}),
                      "gitweave-infra.yaml is missing workflow_dispatch trigger")

    # --- FR-005: README bootstrap content ---

    def test_readme_contains_bootstrap_instructions(self):
        """FR-005: README.md must document the folder structure and bootstrap process."""
        readme_path = os.path.join(self.repo_root, 'README.md')
        content = open(readme_path).read()

        # Key directories must be mentioned
        for directory in ('modules/', 'config/', 'infra/', 'metrics/'):
            self.assertIn(directory, content,
                          f"README.md does not mention directory '{directory}'")

        # Bootstrap section must be present
        self.assertIn('Bootstrap', content,
                      "README.md has no 'Bootstrap' section")
        self.assertIn('bootstrap.sh', content,
                      "README.md does not reference scripts/bootstrap.sh")

    # --- f9cda29: copilot-context.md added by testing-infrastructure commit ---

    def test_copilot_context_file_exists(self):
        """Commit f9cda29 must land: .github/copilot-context.md should exist."""
        path = os.path.join(self.repo_root, '.github', 'copilot-context.md')
        self.assertTrue(os.path.isfile(path),
                        ".github/copilot-context.md is missing — f9cda29 has not landed")

    # --- 3f456f5 / 46f9267: stale Go references removed ---

    def test_no_stale_go_language_references_in_agent_context(self):
        """Commits 3f456f5 and 46f9267 must land: copilot-instructions.md must not mention Go as a Metrics Service language."""
        instructions_path = os.path.join(
            self.repo_root, '.github', 'agents', 'copilot-instructions.md'
        )
        self.assertTrue(os.path.isfile(instructions_path),
                        ".github/agents/copilot-instructions.md is missing")

        content = open(instructions_path).read()

        # The stale entries that should have been removed by 46f9267 and 3f456f5
        stale_phrases = [
            'Go (Metrics Service - Tentative)',
            'Go (Metrics Service)',
        ]
        for phrase in stale_phrases:
            self.assertNotIn(
                phrase, content,
                f"Stale Go reference found in copilot-instructions.md: '{phrase}' — "
                f"commits 3f456f5/46f9267 have not landed",
            )


if __name__ == '__main__':
    unittest.main()
