# Example: per-repo branch protection overrides
#
# Copy this file (or the relevant entries) into your terraform.tfvars to
# harden specific repositories beyond the GitWeave organisation-wide defaults.
#
# Apply with:
#   terraform apply -var-file=examples/branch_protection_override.tfvars
#
# Only repositories tagged with the 'gitweave-managed' GitHub topic are enrolled
# in branch protection. The override map keys are bare repository names (no org
# prefix). Any field omitted here falls back to the global bp_* variable default.

bp_per_repo_overrides = {
  # Raise the review bar and enforce commit signing for a critical service repo.
  "my-critical-service" = {
    required_pr_reviews        = 2
    require_signed_commits     = true
    require_code_owner_reviews = true
  }

  # A repo that still allows force-pushes for automated release tooling.
  "release-automation" = {
    required_pr_reviews = 1
    allow_force_pushes  = true
  }
}
