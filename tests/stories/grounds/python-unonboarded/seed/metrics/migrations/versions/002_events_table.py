"""unified events table — stores all raw GitHub webhook events

Revision ID: 002
Revises: 001
Create Date: 2026-04-05 00:00:00.000000

Introduces the ``events`` table, the single ingestion point for every
incoming GitHub webhook event.  The ``PostgresEventStore`` depends on this
schema contract.  Earlier DORA tables (deployment_events, pr_events,
push_events) remain untouched — they serve computed DORA queries while
``events`` holds the raw payloads for replay and future derived tables.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the unified events table."""
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo", sa.String(length=512), nullable=False),
        sa.Column("event_type", sa.String(length=255), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_events_repo_received_at",
        "events",
        ["repo", "received_at"],
    )


def downgrade() -> None:
    """Drop the unified events table."""
    op.drop_index("ix_events_repo_received_at", table_name="events")
    op.drop_table("events")
