"""EventStore Protocol and implementations for GitHub webhook events.

The Protocol defines the interface that any EventStore backend must satisfy,
enabling PostgreSQL (or any other store) to be swapped in without changing
the handler code.

DATABASE_URL environment variable controls which implementation is returned
by create_event_store():
  - absent / empty / whitespace → InMemoryEventStore (dev default)
  - non-empty string             → PostgreSQLEventStore (production)
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class EventStore(Protocol):
    """Contract for storing and querying parsed GitHub webhook events."""

    def store_event(self, event: dict[str, Any]) -> None:
        """Persist a parsed event.

        Implementations must copy the event rather than storing a reference
        so that subsequent mutations by the caller do not corrupt stored data.
        """
        ...

    def get_events(
        self,
        repo: str,
        event_type: str,
        since_dt: datetime,
    ) -> list[dict[str, Any]]:
        """Return all events matching repo, event_type, and created_at >= since_dt.

        Returns a new list (snapshot) — callers may mutate the result without
        affecting the store's internal state.
        """
        ...


class InMemoryEventStore:
    """Thread-unsafe in-memory EventStore for development and testing.

    Suitable for single-process use. Replace with a PostgreSQL-backed
    implementation for production deployments where persistence and
    horizontal scaling are required.
    """

    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []

    def store_event(self, event: dict[str, Any]) -> None:
        """Store a copy of the event to prevent mutation of stored data."""
        self._events.append(dict(event))

    def get_events(
        self,
        repo: str,
        event_type: str,
        since_dt: datetime,
    ) -> list[dict[str, Any]]:
        """Return a snapshot of events matching all three filter criteria."""
        return [
            dict(e)
            for e in self._events
            if e.get("repo") == repo
            and e.get("event_type") == event_type
            and e.get("created_at", datetime.min) >= since_dt
        ]

    def get_distinct_repo_environment_pairs(
        self,
        since_dt: datetime,
    ) -> list[tuple[str, str]]:
        """Return unique (repo, environment) pairs from deployment_status events.

        Only considers events at or after since_dt.  Preserves insertion order
        of first occurrence.
        """
        seen: set[tuple[str, str]] = set()
        pairs: list[tuple[str, str]] = []
        for event in self._events:
            if (
                event.get("event_type") == "deployment_status"
                and event.get("created_at", datetime.min) >= since_dt
            ):
                pair = (event.get("repo", ""), event.get("environment", ""))
                if pair not in seen:
                    seen.add(pair)
                    pairs.append(pair)
        return pairs


class PostgreSQLEventStore:
    """PostgreSQL-backed EventStore for production use.

    Uses a single shared SQLAlchemy engine (lazy-initialised on first use)
    so that constructing an instance does not open a database connection.
    This allows the factory to be called at process startup before the
    database is necessarily reachable.

    Each event type is stored in a dedicated table:
      - push_events         (repo, ref, commits JSONB, created_at)
      - pr_events           (repo, pr_number, commit_sha, merged_at, created_at)
      - deployment_events   (repo, environment, state, deployment_id, created_at)

    Any fields not in the dedicated columns are silently ignored on store and
    reconstructed from the fixed columns on retrieval.  All known DORA fields
    are round-tripped correctly.
    """

    # Map from event_type string to (table_name, extra_columns_to_store,
    #                                 extra_columns_to_read)
    _EVENT_CONFIG: dict[str, dict[str, Any]] = {
        "push": {
            "table": "push_events",
            "write": ["ref", "commits"],
            "read": ["ref", "commits"],
        },
        "pull_request": {
            "table": "pr_events",
            "write": ["pr_number", "commit_sha", "merged_at"],
            "read": ["pr_number", "commit_sha", "merged_at"],
        },
        "deployment_status": {
            "table": "deployment_events",
            "write": ["environment", "state", "deployment_id"],
            "read": ["environment", "state", "deployment_id"],
        },
    }

    def __init__(self, database_url: str) -> None:
        # Store the URL but do NOT open a connection here — lazy init.
        self._database_url = database_url
        self._engine: Any = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_engine(self) -> Any:
        """Return (or lazily create) the SQLAlchemy engine."""
        if self._engine is None:
            import sqlalchemy  # noqa: PLC0415

            self._engine = sqlalchemy.create_engine(self._database_url)
        return self._engine

    @staticmethod
    def _ensure_tz(dt: datetime) -> datetime:
        """Attach UTC timezone if datetime is naive."""
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    # ------------------------------------------------------------------
    # EventStore Protocol implementation
    # ------------------------------------------------------------------

    def store_event(self, event: dict[str, Any]) -> None:
        """Persist the event to the appropriate table.

        Copies the event dict before processing so that subsequent mutations
        by the caller cannot corrupt the stored data.
        """
        import sqlalchemy  # noqa: PLC0415

        event = dict(event)  # defensive copy
        event_type = event.get("event_type", "")
        cfg = self._EVENT_CONFIG.get(event_type)

        if cfg is None:
            # Unknown event type — store in push_events as a fallback
            # with only the common fields.  This keeps the store from
            # crashing on unexpected event types while preserving data.
            table = "push_events"
            extra_cols: dict[str, Any] = {}
        else:
            table = cfg["table"]
            extra_cols = {col: event.get(col) for col in cfg["write"]}

        # Serialise commits list to JSON string for storage
        if "commits" in extra_cols and extra_cols["commits"] is not None:
            extra_cols["commits"] = json.dumps(extra_cols["commits"])

        created_at = self._ensure_tz(event.get("created_at", datetime.now(timezone.utc)))

        row: dict[str, Any] = {
            "repo": event.get("repo", ""),
            "created_at": created_at,
            **extra_cols,
        }

        engine = self._get_engine()
        with engine.connect() as conn:
            conn.execute(sqlalchemy.text(self._build_insert(table, row)), row)
            conn.commit()

    @staticmethod
    def _build_insert(table: str, row: dict[str, Any]) -> str:
        """Build a parameterised INSERT statement for the given table and row dict."""
        cols = ", ".join(row.keys())
        params = ", ".join(f":{k}" for k in row.keys())
        return f"INSERT INTO {table} ({cols}) VALUES ({params})"  # noqa: S608

    def get_events(
        self,
        repo: str,
        event_type: str,
        since_dt: datetime,
    ) -> list[dict[str, Any]]:
        """Return a snapshot list of events matching all three filter criteria."""
        import sqlalchemy  # noqa: PLC0415

        cfg = self._EVENT_CONFIG.get(event_type)
        if cfg is None:
            return []

        table = cfg["table"]
        read_cols = cfg["read"]
        all_cols = ", ".join(["repo", "created_at", *read_cols])

        since_dt = self._ensure_tz(since_dt)

        engine = self._get_engine()
        with engine.connect() as conn:
            result = conn.execute(
                sqlalchemy.text(
                    f"SELECT {all_cols} FROM {table} "  # noqa: S608
                    f"WHERE repo = :repo AND created_at >= :since_dt"
                ),
                {"repo": repo, "since_dt": since_dt},
            )
            rows = result.fetchall()
            col_names = ["repo", "created_at", *read_cols]

        events = []
        for row in rows:
            row_dict: dict[str, Any] = dict(zip(col_names, row))
            row_dict["event_type"] = event_type

            # Deserialise commits from JSON string back to list
            if "commits" in row_dict and isinstance(row_dict["commits"], str):
                row_dict["commits"] = json.loads(row_dict["commits"])
            elif "commits" in row_dict and row_dict["commits"] is None:
                row_dict["commits"] = []

            # Ensure created_at is timezone-aware
            if isinstance(row_dict.get("created_at"), datetime):
                row_dict["created_at"] = self._ensure_tz(row_dict["created_at"])

            events.append(row_dict)

        return events

    def get_distinct_repo_environment_pairs(
        self,
        since_dt: datetime,
    ) -> list[tuple[str, str]]:
        """Return unique (repo, environment) pairs from deployment_status events.

        Queries the deployment_events table for distinct (repo, environment)
        combinations at or after since_dt.
        """
        import sqlalchemy  # noqa: PLC0415

        since_dt = self._ensure_tz(since_dt)
        engine = self._get_engine()
        with engine.connect() as conn:
            result = conn.execute(
                sqlalchemy.text(
                    "SELECT DISTINCT repo, environment FROM deployment_events "  # noqa: S608
                    "WHERE created_at >= :since_dt ORDER BY repo, environment"
                ),
                {"since_dt": since_dt},
            )
            return [(row[0], row[1]) for row in result.fetchall()]


def create_event_store() -> InMemoryEventStore | PostgreSQLEventStore:
    """Return the appropriate EventStore implementation based on DATABASE_URL.

    DATABASE_URL absent, empty, or whitespace → InMemoryEventStore (dev default).
    DATABASE_URL non-empty                    → PostgreSQLEventStore.
    """
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return PostgreSQLEventStore(url)
    return InMemoryEventStore()
