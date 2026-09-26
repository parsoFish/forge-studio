"""initial schema — deployment_events, pr_events, push_events

Revision ID: 001
Revises:
Create Date: 2026-03-08 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the three DORA event tables."""
    op.create_table(
        "deployment_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo", sa.String(length=512), nullable=False),
        sa.Column("environment", sa.String(length=255), nullable=True),
        sa.Column("state", sa.String(length=64), nullable=True),
        sa.Column("deployment_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_deployment_events_repo_created_at",
        "deployment_events",
        ["repo", "created_at"],
    )

    op.create_table(
        "pr_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo", sa.String(length=512), nullable=False),
        sa.Column("pr_number", sa.Integer(), nullable=True),
        sa.Column("commit_sha", sa.String(length=64), nullable=True),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_pr_events_repo_created_at",
        "pr_events",
        ["repo", "created_at"],
    )

    op.create_table(
        "push_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo", sa.String(length=512), nullable=False),
        sa.Column("ref", sa.String(length=512), nullable=True),
        sa.Column("commits", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_push_events_repo_created_at",
        "push_events",
        ["repo", "created_at"],
    )


def downgrade() -> None:
    """Drop all three DORA event tables."""
    op.drop_index("ix_push_events_repo_created_at", table_name="push_events")
    op.drop_table("push_events")

    op.drop_index("ix_pr_events_repo_created_at", table_name="pr_events")
    op.drop_table("pr_events")

    op.drop_index("ix_deployment_events_repo_created_at", table_name="deployment_events")
    op.drop_table("deployment_events")
