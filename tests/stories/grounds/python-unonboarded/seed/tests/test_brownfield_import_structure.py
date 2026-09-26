"""
Static structure tests for the brownfield Terraform import script and adoption guide.

Verifies (without running the script) that:
  - scripts/import-existing-repos.sh exists and is executable
  - The script contains a shebang line
  - The script accepts/references GITHUB_ORG as an input variable
  - The script validates that gh CLI is present (command check)
  - The script validates gh CLI authentication and exits non-zero if unauthenticated
  - The script validates that terraform is initialized
  - The script outputs 'terraform import' commands for github_repository resources
  - The script outputs 'terraform import' commands for github_team resources
  - docs/brownfield-adoption.md exists and contains numbered adoption steps
  - docs/brownfield-adoption.md covers all required sections:
      prerequisites, running the script, reviewing the plan, resolving drift,
      and the 'Onboarding PR' pattern
  - .github/ISSUE_TEMPLATE/repo-onboarding.md exists as an issue template
  - The issue template has a title and label indicating repo onboarding tracking

All tests fail until the implementation is in place (TDD red phase).
"""

import os
import re
import stat
import unittest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IMPORT_SCRIPT = os.path.join(REPO_ROOT, "scripts", "import-existing-repos.sh")
ADOPTION_GUIDE = os.path.join(REPO_ROOT, "docs", "brownfield-adoption.md")
ISSUE_TEMPLATE = os.path.join(REPO_ROOT, ".github", "ISSUE_TEMPLATE", "repo-onboarding.md")


def _read_script() -> str:
    """Return contents of the import script, or empty string if absent."""
    if not os.path.exists(IMPORT_SCRIPT):
        return ""
    with open(IMPORT_SCRIPT) as f:
        return f.read()


def _read_adoption_guide() -> str:
    """Return contents of docs/brownfield-adoption.md, or empty string if absent."""
    if not os.path.exists(ADOPTION_GUIDE):
        return ""
    with open(ADOPTION_GUIDE) as f:
        return f.read()


def _read_issue_template() -> str:
    """Return contents of the repo-onboarding issue template, or empty string if absent."""
    if not os.path.exists(ISSUE_TEMPLATE):
        return ""
    with open(ISSUE_TEMPLATE) as f:
        return f.read()


# ---------------------------------------------------------------------------
# Script file existence and permissions
# ---------------------------------------------------------------------------


class TestImportScriptExists(unittest.TestCase):
    """scripts/import-existing-repos.sh must exist and be executable."""

    def test_import_script_exists(self):
        """
        scripts/import-existing-repos.sh must exist — this is the primary
        deliverable for brownfield adoption, enabling operators to generate
        import commands without manual enumeration.
        """
        self.assertTrue(
            os.path.exists(IMPORT_SCRIPT),
            f"scripts/import-existing-repos.sh not found at {IMPORT_SCRIPT} — "
            "the brownfield import script must be created",
        )

    def test_import_script_is_not_empty(self):
        """A placeholder empty file does not satisfy the requirement."""
        if not os.path.exists(IMPORT_SCRIPT):
            self.skipTest("import script does not exist — handled by previous test")
        self.assertGreater(
            os.path.getsize(IMPORT_SCRIPT),
            0,
            "scripts/import-existing-repos.sh exists but is empty",
        )

    def test_import_script_is_executable(self):
        """
        The script must have the executable bit set — operators must be able
        to run it directly as ./scripts/import-existing-repos.sh without
        explicitly invoking bash.
        """
        if not os.path.exists(IMPORT_SCRIPT):
            self.skipTest("import script does not exist — handled by previous test")
        mode = os.stat(IMPORT_SCRIPT).st_mode
        self.assertTrue(
            bool(mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)),
            "scripts/import-existing-repos.sh must have the executable bit set "
            "(chmod +x scripts/import-existing-repos.sh)",
        )

    def test_import_script_has_shebang_line(self):
        """
        The script must start with a shebang (#!/usr/bin/env bash or #!/bin/bash) —
        without a shebang, the OS cannot determine which interpreter to use.
        """
        content = _read_script()
        if not content:
            self.skipTest("import script does not exist — handled by previous test")
        self.assertRegex(
            content.splitlines()[0],
            r"^#!.*(bash|sh)",
            "scripts/import-existing-repos.sh must begin with a bash shebang line "
            "(e.g. #!/usr/bin/env bash)",
        )

    def test_import_script_enables_strict_mode(self):
        """
        The script must enable bash strict mode (set -e or set -euo pipefail) —
        without this, errors in sub-commands are silently ignored and the script
        may emit partial, incorrect output.
        """
        content = _read_script()
        if not content:
            self.skipTest("import script does not exist — handled by previous test")
        self.assertRegex(
            content,
            r"set\s+-[euo]*e[uo]*",
            "scripts/import-existing-repos.sh must use 'set -e' or 'set -euo pipefail' "
            "to ensure errors abort execution",
        )


# ---------------------------------------------------------------------------
# GITHUB_ORG input
# ---------------------------------------------------------------------------


class TestImportScriptGithubOrgInput(unittest.TestCase):
    """The script must accept GITHUB_ORG as a configurable input."""

    def _content(self) -> str:
        content = _read_script()
        if not content:
            self.skipTest("import script does not exist")
        return content

    def test_script_references_github_org_variable(self):
        """
        The script must reference GITHUB_ORG — either as a positional argument
        ($1), an environment variable, or a named variable — so the operator
        can target a specific GitHub organisation without editing the script.
        """
        content = self._content()
        self.assertIn(
            "GITHUB_ORG",
            content,
            "scripts/import-existing-repos.sh must reference 'GITHUB_ORG' to accept "
            "the target organisation as input",
        )

    def test_script_exits_with_error_when_github_org_not_set(self):
        """
        The script must guard against an empty GITHUB_ORG — running the import
        against an empty org name would produce nonsensical terraform import commands.
        The script must emit an error message and exit non-zero when GITHUB_ORG is unset.
        """
        content = self._content()
        # Look for a guard: parameter expansion with error, an explicit -z check,
        # or a usage message when GITHUB_ORG is absent.
        has_guard = bool(
            re.search(r'\$\{GITHUB_ORG[?!]', content)      # ${GITHUB_ORG?error} or ${GITHUB_ORG:?error}
            or re.search(r'-z\s+["\']?\$GITHUB_ORG', content)  # [ -z "$GITHUB_ORG" ]
            or re.search(r'\[\[\s+-z\s+["\']?\$GITHUB_ORG', content)
            or re.search(r'GITHUB_ORG.*:-', content)          # default value pattern
        )
        self.assertTrue(
            has_guard,
            "scripts/import-existing-repos.sh must validate that GITHUB_ORG is set and "
            "non-empty before proceeding — unguarded empty org would produce invalid imports",
        )


# ---------------------------------------------------------------------------
# Prerequisite validation: gh CLI
# ---------------------------------------------------------------------------


class TestImportScriptGhCliValidation(unittest.TestCase):
    """The script must verify gh CLI is present and authenticated before proceeding."""

    def _content(self) -> str:
        content = _read_script()
        if not content:
            self.skipTest("import script does not exist")
        return content

    def test_script_checks_gh_cli_is_installed(self):
        """
        The script must verify the gh CLI binary is available on PATH before
        invoking it — a clear 'gh not found' error is far more helpful than
        'command not found' deep in the script body.
        """
        content = self._content()
        has_gh_check = bool(
            re.search(r"command\s+-v\s+gh\b", content)
            or re.search(r"which\s+gh\b", content)
            or re.search(r"type\s+gh\b", content)
        )
        self.assertTrue(
            has_gh_check,
            "scripts/import-existing-repos.sh must check that 'gh' is installed "
            "(e.g. 'command -v gh') before attempting to invoke it",
        )

    def test_script_validates_gh_authentication(self):
        """
        The script must verify gh CLI authentication (e.g. via 'gh auth status')
        before listing repos and teams — an unauthenticated call would return
        an empty or error response, producing no import commands silently.
        """
        content = self._content()
        has_auth_check = bool(
            re.search(r"gh\s+auth\s+status", content)
            or re.search(r"gh\s+auth\s+token", content)
        )
        self.assertTrue(
            has_auth_check,
            "scripts/import-existing-repos.sh must validate gh CLI authentication "
            "(e.g. 'gh auth status') before listing organisation resources",
        )

    def test_script_exits_nonzero_when_gh_not_authenticated(self):
        """
        When 'gh auth status' fails the script must exit with a non-zero code
        and print a descriptive error — silent continuation would produce an
        empty import file with no indication of what went wrong.

        The script must contain an error handler around the auth check that
        calls 'exit 1' (or exits with a non-zero status) on auth failure.
        """
        content = self._content()
        # The pattern: check gh auth status and exit 1 on failure.
        # Accept: if ! gh auth status ...; then ... exit 1; fi
        # Or:     gh auth status || { echo ...; exit 1; }
        # Or:     gh auth status || exit 1
        has_exit_on_auth_fail = bool(
            re.search(r"gh\s+auth\s+status[^\n]*\|\|[^\n]*exit\s+[1-9]", content)
            or re.search(
                r"if\s+[^;]*gh\s+auth\s+status[^;]*;[^f]*then[^f]*exit\s+[1-9]",
                content,
                re.DOTALL,
            )
            or re.search(
                r"if\s*!\s*gh\s+auth\s+status",
                content,
            )
        )
        self.assertTrue(
            has_exit_on_auth_fail,
            "scripts/import-existing-repos.sh must exit non-zero when gh auth status fails — "
            "the script must not silently continue with an unauthenticated gh session",
        )


# ---------------------------------------------------------------------------
# Prerequisite validation: terraform
# ---------------------------------------------------------------------------


class TestImportScriptTerraformValidation(unittest.TestCase):
    """The script must verify terraform is available and initialized."""

    def _content(self) -> str:
        content = _read_script()
        if not content:
            self.skipTest("import script does not exist")
        return content

    def test_script_checks_terraform_is_installed(self):
        """
        The script must verify the terraform binary is available before
        emitting import commands — otherwise operators get a misleading
        error when trying to execute the generated commands.
        """
        content = self._content()
        has_tf_check = bool(
            re.search(r"command\s+-v\s+terraform\b", content)
            or re.search(r"which\s+terraform\b", content)
            or re.search(r"type\s+terraform\b", content)
        )
        self.assertTrue(
            has_tf_check,
            "scripts/import-existing-repos.sh must check that 'terraform' is installed "
            "before emitting import commands",
        )

    def test_script_checks_terraform_initialized(self):
        """
        The script must verify that terraform has been initialised (i.e. that the
        .terraform directory or lock file is present) — running 'terraform import'
        against an uninitialised workspace always fails.
        """
        content = self._content()
        has_init_check = bool(
            re.search(r"\.terraform", content)
            or re.search(r"terraform\s+init", content)
            or re.search(r"\.terraform\.lock\.hcl", content)
        )
        self.assertTrue(
            has_init_check,
            "scripts/import-existing-repos.sh must verify terraform is initialized "
            "(check for .terraform directory or .terraform.lock.hcl) before proceeding",
        )


# ---------------------------------------------------------------------------
# Output: terraform import commands
# ---------------------------------------------------------------------------


class TestImportScriptOutputFormat(unittest.TestCase):
    """The script must emit well-formed terraform import commands."""

    def _content(self) -> str:
        content = _read_script()
        if not content:
            self.skipTest("import script does not exist")
        return content

    def test_script_outputs_terraform_import_for_repositories(self):
        """
        The script must emit 'terraform import' commands for github_repository
        resources — this is the primary import target for brownfield adoption.
        Each line must follow the pattern:
            terraform import github_repository.<name>["<repo>"] <org>/<repo>
        """
        content = self._content()
        has_repo_import = bool(
            re.search(r"terraform\s+import\s+github_repository", content)
            or re.search(r'echo.*terraform import.*github_repository', content)
            or re.search(r'printf.*terraform import.*github_repository', content)
        )
        self.assertTrue(
            has_repo_import,
            "scripts/import-existing-repos.sh must output 'terraform import github_repository' "
            "commands for each repository found in the organisation",
        )

    def test_script_outputs_terraform_import_for_teams(self):
        """
        The script must emit 'terraform import' commands for github_team resources
        — teams govern repository access and must be brought under Terraform management
        alongside repositories.
        """
        content = self._content()
        has_team_import = bool(
            re.search(r"terraform\s+import\s+github_team", content)
            or re.search(r'echo.*terraform import.*github_team', content)
            or re.search(r'printf.*terraform import.*github_team', content)
        )
        self.assertTrue(
            has_team_import,
            "scripts/import-existing-repos.sh must output 'terraform import github_team' "
            "commands for each team found in the organisation",
        )

    def test_script_uses_gh_repo_list_to_enumerate_repos(self):
        """
        The script must use 'gh repo list' to enumerate organisation repositories —
        this is the correct, authenticated mechanism for listing org repos via the
        gh CLI without requiring direct API calls.
        """
        content = self._content()
        self.assertRegex(
            content,
            r"gh\s+repo\s+list",
            "scripts/import-existing-repos.sh must use 'gh repo list' to enumerate "
            "repositories in the target organisation",
        )

    def test_script_uses_gh_api_or_gh_team_list_to_enumerate_teams(self):
        """
        The script must use 'gh api' or 'gh team list' (or equivalent) to enumerate
        organisation teams — teams require separate enumeration from repositories.
        """
        content = self._content()
        has_team_enumeration = bool(
            re.search(r"gh\s+api\b.*orgs", content, re.DOTALL)
            or re.search(r"gh\s+api\b.*teams", content, re.DOTALL)
            or re.search(r"gh\s+team\s+list", content)
            or re.search(r"orgs/[^/\"']*/teams", content)
            or re.search(r'orgs.*teams', content)
        )
        self.assertTrue(
            has_team_enumeration,
            "scripts/import-existing-repos.sh must enumerate teams via 'gh api' or "
            "'gh team list' — found no team-listing command in the script",
        )


# ---------------------------------------------------------------------------
# docs/brownfield-adoption.md
# ---------------------------------------------------------------------------


class TestAdoptionGuideExists(unittest.TestCase):
    """docs/brownfield-adoption.md must exist with comprehensive adoption steps."""

    def test_adoption_guide_exists(self):
        """
        docs/brownfield-adoption.md must exist — operators need a step-by-step
        guide to safely onboard existing infrastructure into Terraform management.
        """
        self.assertTrue(
            os.path.exists(ADOPTION_GUIDE),
            f"docs/brownfield-adoption.md not found at {ADOPTION_GUIDE} — "
            "the brownfield adoption guide must be created",
        )

    def test_adoption_guide_is_not_empty(self):
        """A placeholder file does not constitute a guide."""
        if not os.path.exists(ADOPTION_GUIDE):
            self.skipTest("adoption guide does not exist — handled by previous test")
        self.assertGreater(
            os.path.getsize(ADOPTION_GUIDE),
            0,
            "docs/brownfield-adoption.md exists but is empty",
        )

    def test_adoption_guide_has_numbered_steps(self):
        """
        The guide must contain numbered steps — operators follow adoption in order,
        and numbered steps make the sequence unambiguous and easy to track.
        Expected format: lines beginning with '1.', '2.', '3.', etc.
        """
        content = _read_adoption_guide()
        if not content:
            self.skipTest("adoption guide does not exist — handled by previous test")
        numbered_steps = re.findall(r"^\s*\d+\.\s+\S", content, re.MULTILINE)
        self.assertGreaterEqual(
            len(numbered_steps),
            4,
            "docs/brownfield-adoption.md must contain at least 4 numbered steps covering "
            "the full adoption flow (prerequisites → script → review → drift → onboarding PR)",
        )


class TestAdoptionGuideCoversRequiredSections(unittest.TestCase):
    """The guide must cover all five required sections of the adoption flow."""

    def _content(self) -> str:
        content = _read_adoption_guide()
        if not content:
            self.skipTest("adoption guide does not exist")
        return content

    def test_guide_covers_prerequisites(self):
        """
        The guide must include a prerequisites section — operators must know
        which tools to install and authenticate before running the import script.
        """
        content = self._content()
        has_prereqs = bool(
            re.search(r"prerequisite", content, re.IGNORECASE)
            or re.search(r"## .*before", content, re.IGNORECASE)
            or re.search(r"## .*require", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_prereqs,
            "docs/brownfield-adoption.md must include a prerequisites section",
        )

    def test_guide_covers_running_the_import_script(self):
        """
        The guide must document how to run the import script — operators need
        the exact invocation command including the GITHUB_ORG argument.
        """
        content = self._content()
        has_script_section = bool(
            re.search(r"import-existing-repos\.sh", content)
            or re.search(r"import script", content, re.IGNORECASE)
            or re.search(r"running the script", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_script_section,
            "docs/brownfield-adoption.md must document how to run the import script "
            "(import-existing-repos.sh)",
        )

    def test_guide_covers_reviewing_the_import_plan(self):
        """
        The guide must explain how to review the generated import commands before
        executing them — operators must inspect the plan to catch mismatches
        between existing resources and Terraform resource addresses.
        """
        content = self._content()
        has_review_section = bool(
            re.search(r"review", content, re.IGNORECASE)
            or re.search(r"plan", content, re.IGNORECASE)
            or re.search(r"inspect", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_review_section,
            "docs/brownfield-adoption.md must cover reviewing/inspecting the "
            "generated import plan before applying it",
        )

    def test_guide_covers_resolving_drift(self):
        """
        The guide must explain how to resolve configuration drift — after import,
        'terraform plan' will show differences between actual state and declared
        config; operators must know how to reconcile these differences.
        """
        content = self._content()
        has_drift_section = bool(
            re.search(r"drift", content, re.IGNORECASE)
            or re.search(r"reconcil", content, re.IGNORECASE)
            or re.search(r"terraform plan", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_drift_section,
            "docs/brownfield-adoption.md must cover resolving configuration drift "
            "after import (reviewing 'terraform plan' output and aligning config)",
        )

    def test_guide_covers_onboarding_pr_pattern(self):
        """
        The guide must document the 'Onboarding PR' pattern — the standard way
        to propose and review adding a legacy repository to GitWeave management.
        This provides a trackable, reviewable adoption workflow.
        """
        content = self._content()
        has_onboarding_pr = bool(
            re.search(r"[Oo]nboarding\s+PR", content)
            or re.search(r"onboarding pull request", content, re.IGNORECASE)
            or re.search(r"## .*[Oo]nboarding", content)
        )
        self.assertTrue(
            has_onboarding_pr,
            "docs/brownfield-adoption.md must document the 'Onboarding PR' pattern "
            "for tracking legacy repository adoption via pull requests",
        )

    def test_guide_references_github_org_variable(self):
        """
        The guide must show GITHUB_ORG in the script invocation example —
        operators must know to set this value before running the script.
        """
        content = self._content()
        self.assertIn(
            "GITHUB_ORG",
            content,
            "docs/brownfield-adoption.md must include an example that references "
            "GITHUB_ORG so operators know how to target their organisation",
        )


# ---------------------------------------------------------------------------
# .github/ISSUE_TEMPLATE/repo-onboarding.md
# ---------------------------------------------------------------------------


class TestRepoOnboardingIssueTemplate(unittest.TestCase):
    """An issue template must exist for tracking legacy repo adoption."""

    def test_repo_onboarding_issue_template_exists(self):
        """
        .github/ISSUE_TEMPLATE/repo-onboarding.md must exist — every legacy
        repository adoption should be tracked as a GitHub Issue using this
        template to ensure consistent information capture and progress visibility.
        """
        self.assertTrue(
            os.path.exists(ISSUE_TEMPLATE),
            f".github/ISSUE_TEMPLATE/repo-onboarding.md not found at {ISSUE_TEMPLATE} — "
            "a GitHub Issue template for repo onboarding tracking must be created",
        )

    def test_repo_onboarding_issue_template_is_not_empty(self):
        """A placeholder issue template does not serve the tracking purpose."""
        if not os.path.exists(ISSUE_TEMPLATE):
            self.skipTest("issue template does not exist — handled by previous test")
        self.assertGreater(
            os.path.getsize(ISSUE_TEMPLATE),
            0,
            ".github/ISSUE_TEMPLATE/repo-onboarding.md exists but is empty",
        )

    def test_issue_template_has_yaml_frontmatter(self):
        """
        The issue template must have YAML frontmatter (--- delimiters) with
        at least a 'name' or 'title' field — GitHub uses this metadata to
        display the template in the 'New Issue' picker.
        """
        content = _read_issue_template()
        if not content:
            self.skipTest("issue template does not exist — handled by previous test")
        has_frontmatter = bool(
            re.match(r"^---\s*\n", content)
            and re.search(r"\n---\s*\n", content)
        )
        self.assertTrue(
            has_frontmatter,
            ".github/ISSUE_TEMPLATE/repo-onboarding.md must have YAML frontmatter "
            "(--- delimiters) for GitHub to recognise it as an issue template",
        )

    def test_issue_template_has_name_or_title_in_frontmatter(self):
        """
        The template frontmatter must include a 'name' field — this is the
        label shown to users selecting a template when opening a new issue.
        """
        content = _read_issue_template()
        if not content:
            self.skipTest("issue template does not exist — handled by previous test")
        # Extract frontmatter between the first two --- delimiters
        frontmatter_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
        if not frontmatter_match:
            self.fail(
                "Could not parse YAML frontmatter from issue template — "
                "ensure the template starts with '---' delimiters"
            )
        frontmatter = frontmatter_match.group(1)
        self.assertRegex(
            frontmatter,
            r"^(name|title)\s*:",
            ".github/ISSUE_TEMPLATE/repo-onboarding.md frontmatter must include "
            "a 'name' or 'title' field",
        )

    def test_issue_template_references_onboarding_or_repo(self):
        """
        The issue template body must reference 'onboarding' or 'repository' —
        the content must be specific to the legacy repo adoption use case rather
        than being a generic template that lacks domain context.
        """
        content = _read_issue_template()
        if not content:
            self.skipTest("issue template does not exist — handled by previous test")
        has_relevant_content = bool(
            re.search(r"onboard", content, re.IGNORECASE)
            or re.search(r"repositor", content, re.IGNORECASE)
            or re.search(r"legacy", content, re.IGNORECASE)
            or re.search(r"import", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_relevant_content,
            ".github/ISSUE_TEMPLATE/repo-onboarding.md body must reference 'onboarding', "
            "'repository', 'legacy', or 'import' to be relevant to the adoption use case",
        )

    def test_issue_template_has_checklist_for_adoption_steps(self):
        """
        The issue template must include a checklist (GitHub-flavoured markdown task list)
        — a checklist lets assignees tick off each adoption step, giving clear visibility
        of progress on each onboarding issue.
        """
        content = _read_issue_template()
        if not content:
            self.skipTest("issue template does not exist — handled by previous test")
        has_checklist = bool(
            re.search(r"^- \[ \]", content, re.MULTILINE)
            or re.search(r"^\* \[ \]", content, re.MULTILINE)
        )
        self.assertTrue(
            has_checklist,
            ".github/ISSUE_TEMPLATE/repo-onboarding.md must include a markdown task "
            "checklist (- [ ] items) for tracking adoption steps per issue",
        )


if __name__ == "__main__":
    unittest.main()
