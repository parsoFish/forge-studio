terraform {
  required_version = ">= 1.0.0"
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
  # Backend configuration should be added here by the user
  # backend "s3" {}
}

provider "github" {
  owner = var.github_org
}

locals {
  teams_config = yamldecode(file("${path.module}/../config/teams.yaml"))

  # Build a map keyed by team name for use with for_each
  teams = { for t in local.teams_config.teams : t.name => t }

  # Top-level teams (no parent) must be created before sub-teams to avoid
  # a self-referential cycle inside a single github_team for_each block.
  root_teams = {
    for k, v in local.teams : k => v
    if lookup(v, "parent_team", null) == null
  }

  # Sub-teams reference a parent that is guaranteed to be in root_teams.
  # Supports one level of nesting; extend with additional resources if
  # deeper hierarchies are needed.
  sub_teams = {
    for k, v in local.teams : k => v
    if lookup(v, "parent_team", null) != null
  }

  # Flatten nested members lists into a single map keyed by "team/username"
  # so github_team_membership can iterate with for_each
  team_memberships = merge([
    for team in local.teams_config.teams : {
      for member in lookup(team, "members", []) :
      "${team.name}/${member.username}" => {
        team_name = team.name
        username  = member.username
        role      = member.role
      }
    }
  ]...)
}

resource "github_team" "root_teams" {
  for_each = local.root_teams

  name        = each.value.name
  description = each.value.description
  privacy     = each.value.privacy
}

resource "github_team" "sub_teams" {
  for_each = local.sub_teams

  name           = each.value.name
  description    = each.value.description
  privacy        = each.value.privacy
  parent_team_id = github_team.root_teams[each.value.parent_team].id
}

resource "github_team_membership" "memberships" {
  for_each = local.team_memberships

  # Look up the team ID from the correct resource based on team type
  team_id = (
    contains(keys(local.root_teams), each.value.team_name)
    ? github_team.root_teams[each.value.team_name].id
    : github_team.sub_teams[each.value.team_name].id
  )
  username = each.value.username
  role     = each.value.role
}
