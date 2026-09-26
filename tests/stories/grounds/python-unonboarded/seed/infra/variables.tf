variable "github_org" {
  description = "The GitHub Organization name"
  type        = string
}

# ---------------------------------------------------------------------------
# Branch protection defaults
#
# These variables set the global baseline applied to every repository tagged
# with the 'gitweave-managed' GitHub topic.  Operators can harden specific
# repositories without touching these defaults by supplying entries in
# bp_per_repo_overrides.
# ---------------------------------------------------------------------------

variable "bp_required_pr_reviews" {
  description = "Default number of approving reviews required before a PR can merge. Prevents self-merges while staying permissive enough for solo projects."
  type        = number
  default     = 1
}

variable "bp_dismiss_stale_reviews" {
  description = "When true, existing approvals are dismissed whenever new commits are pushed to the PR branch, forcing re-review of updated code."
  type        = bool
  default     = true
}

variable "bp_require_code_owner_reviews" {
  description = "When true, a review from a CODEOWNERS entry that matches changed files is required before the PR can merge."
  type        = bool
  default     = false
}

variable "bp_require_signed_commits" {
  description = "When true, all commits on the protected branch must be GPG-signed. Defaults to false to avoid breaking contributor onboarding; enable per-repo via bp_per_repo_overrides for critical repositories."
  type        = bool
  default     = false
}

variable "bp_require_linear_history" {
  description = "When true, merge commits are prohibited and the branch history must remain linear (squash or rebase only)."
  type        = bool
  default     = false
}

variable "bp_enforce_admins" {
  description = "When true, repository administrators are subject to the same branch protection rules as regular contributors."
  type        = bool
  default     = true
}

variable "bp_allow_force_pushes" {
  description = "When false (default), force pushes to the protected branch are blocked for all users. Force pushes rewrite history and destroy audit trails; they must be explicitly opted-in."
  type        = bool
  default     = false
}

variable "bp_required_status_check_contexts" {
  description = "List of CI status check context names that must pass before a PR can merge. Empty by default; populate with job names from your GitHub Actions workflows."
  type        = list(string)
  default     = []
}

variable "bp_per_repo_overrides" {
  description = <<-EOT
    Per-repository overrides for branch protection settings. Keyed by repository
    name (without the org prefix). Any field left as null falls back to the global
    default variable.

    Use this to harden specific repositories — for example to require 2 reviews
    or enable signed commits — without changing the organisation-wide defaults.

    Only repositories tagged with the 'gitweave-managed' GitHub topic are enrolled
    in GitWeave branch protection. Adding a topic to a repository is the recommended
    way to opt it in; removing the topic opts it out without touching this variable.

    Example:
      bp_per_repo_overrides = {
        "my-critical-service" = {
          required_pr_reviews    = 2
          require_signed_commits = true
        }
      }
  EOT
  type = map(object({
    required_pr_reviews            = optional(number)
    dismiss_stale_reviews          = optional(bool)
    require_code_owner_reviews     = optional(bool)
    require_signed_commits         = optional(bool)
    require_linear_history         = optional(bool)
    enforce_admins                 = optional(bool)
    allow_force_pushes             = optional(bool)
    required_status_check_contexts = optional(list(string))
  }))
  default = {}
}
