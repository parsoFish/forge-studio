# Fetch all repositories in the organisation tagged with the 'gitweave-managed' GitHub topic.
# Only these repositories are subject to GitWeave branch protection enforcement.
# To opt a repository out of management, remove the 'gitweave-managed' topic from it.
data "github_repositories" "managed" {
  query = "org:${var.github_org} topic:gitweave-managed"
}

locals {
  # Merge global branch protection defaults with any per-repo overrides.
  # Per-repo overrides take precedence; unset override fields fall back to the global default.
  branch_protection_configs = {
    for repo in data.github_repositories.managed.names : repo => {
      required_pr_reviews = (
        try(var.bp_per_repo_overrides[repo].required_pr_reviews, null) != null
        ? var.bp_per_repo_overrides[repo].required_pr_reviews
        : var.bp_required_pr_reviews
      )
      dismiss_stale_reviews = (
        try(var.bp_per_repo_overrides[repo].dismiss_stale_reviews, null) != null
        ? var.bp_per_repo_overrides[repo].dismiss_stale_reviews
        : var.bp_dismiss_stale_reviews
      )
      require_code_owner_reviews = (
        try(var.bp_per_repo_overrides[repo].require_code_owner_reviews, null) != null
        ? var.bp_per_repo_overrides[repo].require_code_owner_reviews
        : var.bp_require_code_owner_reviews
      )
      require_signed_commits = (
        try(var.bp_per_repo_overrides[repo].require_signed_commits, null) != null
        ? var.bp_per_repo_overrides[repo].require_signed_commits
        : var.bp_require_signed_commits
      )
      require_linear_history = (
        try(var.bp_per_repo_overrides[repo].require_linear_history, null) != null
        ? var.bp_per_repo_overrides[repo].require_linear_history
        : var.bp_require_linear_history
      )
      enforce_admins = (
        try(var.bp_per_repo_overrides[repo].enforce_admins, null) != null
        ? var.bp_per_repo_overrides[repo].enforce_admins
        : var.bp_enforce_admins
      )
      allow_force_pushes = (
        try(var.bp_per_repo_overrides[repo].allow_force_pushes, null) != null
        ? var.bp_per_repo_overrides[repo].allow_force_pushes
        : var.bp_allow_force_pushes
      )
      required_status_check_contexts = (
        try(var.bp_per_repo_overrides[repo].required_status_check_contexts, null) != null
        ? var.bp_per_repo_overrides[repo].required_status_check_contexts
        : var.bp_required_status_check_contexts
      )
    }
  }
}

resource "github_branch_protection" "rules" {
  for_each = local.branch_protection_configs

  repository_id           = each.key
  pattern                 = "main"
  require_signed_commits  = each.value.require_signed_commits
  required_linear_history = each.value.require_linear_history
  enforce_admins          = each.value.enforce_admins
  allows_force_pushes     = each.value.allow_force_pushes

  required_status_checks {
    strict   = true
    contexts = each.value.required_status_check_contexts
  }

  required_pull_request_reviews {
    required_approving_review_count = each.value.required_pr_reviews
    dismiss_stale_reviews           = each.value.dismiss_stale_reviews
    require_code_owner_reviews      = each.value.require_code_owner_reviews
  }
}
