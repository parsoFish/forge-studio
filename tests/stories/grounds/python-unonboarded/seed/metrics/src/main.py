"""FastAPI application for GitWeave metrics observation and webhook event dispatch.

Replaces the original dummy metrics loop with a proper HTTP service exposing:
  - POST /webhook  — dispatches GitHub webhook events by X-GitHub-Event header
  - GET  /healthz  — liveness/readiness probe (always 200, no auth)
  - GET  /metrics  — Prometheus exposition format (no auth required)
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, Counter, Gauge, generate_latest

from replay import replay_counters_from_store
from store import create_event_store

from dora.change_failure_rate import compute_change_failure_rate
from dora.deployment_frequency import compute_deployment_frequency
from dora.lead_time_for_changes import compute_lead_time_for_changes
from dora.mttr import compute_mttr

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Backward-compatible dummy metric — preserved so test_main.py keeps passing.
# Unregistered from the Prometheus registry so it does not appear in /metrics
# output once the real DORA gauges are wired in.
# ---------------------------------------------------------------------------
try:
    DUMMY_METRIC = Gauge("gitweave_dummy_metric", "A dummy metric for testing")
except ValueError:
    # Metric already registered (module reloaded via importlib.reload in tests).
    DUMMY_METRIC = REGISTRY._names_to_collectors.get("gitweave_dummy_metric")

# Remove from the registry so it does not appear in Prometheus scrape output.
try:
    REGISTRY.unregister(DUMMY_METRIC)
except Exception:  # noqa: BLE001
    pass  # Already unregistered or not found — safe to ignore.

# ---------------------------------------------------------------------------
# DORA Prometheus gauges — registered once at module level.
# Uses try/except to survive importlib.reload() calls in tests.
# ---------------------------------------------------------------------------

try:
    DEPLOYMENT_FREQUENCY_GAUGE = Gauge(
        "gitweave_deployment_frequency_daily",
        "Daily deployment frequency (deployments per day) over the last 30 days",
        ["repository", "environment"],
    )
except ValueError:
    DEPLOYMENT_FREQUENCY_GAUGE = REGISTRY._names_to_collectors.get(
        "gitweave_deployment_frequency_daily"
    )

try:
    LEAD_TIME_GAUGE = Gauge(
        "gitweave_lead_time_for_changes_seconds",
        "Mean lead time for changes (seconds) from PR merge to successful deployment",
        ["repository", "environment"],
    )
except ValueError:
    LEAD_TIME_GAUGE = REGISTRY._names_to_collectors.get(
        "gitweave_lead_time_for_changes_seconds"
    )

try:
    CHANGE_FAILURE_RATE_GAUGE = Gauge(
        "gitweave_change_failure_rate",
        "Proportion of deployments that resulted in a failure (0.0–1.0)",
        ["repository", "environment"],
    )
except ValueError:
    CHANGE_FAILURE_RATE_GAUGE = REGISTRY._names_to_collectors.get(
        "gitweave_change_failure_rate"
    )

try:
    MTTR_GAUGE = Gauge(
        "gitweave_mttr_seconds",
        "Mean time to restore (seconds) from deployment failure to recovery",
        ["repository", "environment"],
    )
except ValueError:
    MTTR_GAUGE = REGISTRY._names_to_collectors.get("gitweave_mttr_seconds")

# ---------------------------------------------------------------------------
# DORA Prometheus counters — module-level so /metrics always exposes them.
# Uses try/except to survive importlib.reload() calls in PORT env-var tests.
# ---------------------------------------------------------------------------
try:
    PUSH_COUNTER = Counter("gitweave_push_events", "Total push events processed")
except ValueError:
    PUSH_COUNTER = REGISTRY._names_to_collectors.get("gitweave_push_events")  # noqa: SLF001

try:
    PR_COUNTER = Counter("gitweave_pr_merged", "Total merged pull request events processed")
except ValueError:
    PR_COUNTER = REGISTRY._names_to_collectors.get("gitweave_pr_merged")  # noqa: SLF001

try:
    DEPLOYMENT_COUNTER = Counter(
        "gitweave_deployment_events", "Total deployment status events processed"
    )
except ValueError:
    DEPLOYMENT_COUNTER = REGISTRY._names_to_collectors.get("gitweave_deployment_events")  # noqa: SLF001

# ---------------------------------------------------------------------------
# Port configuration — integer so uvicorn accepts it directly.
# ---------------------------------------------------------------------------
PORT: int = int(os.environ.get("PORT", 8000))

# ---------------------------------------------------------------------------
# Supported GitHub event types for GitWeave
# ---------------------------------------------------------------------------
SUPPORTED_EVENTS: set[str] = {
    "push",
    "deployment",
    "deployment_status",
    "workflow_run",
    "release",
    "create",
}


# ---------------------------------------------------------------------------
# EventStore — injectable dependency for tracking processed events
# ---------------------------------------------------------------------------


class EventStore:
    """Lightweight in-process store for processed webhook events.

    Designed for dependency injection: tests inject a fresh store per test
    case via FastAPI's dependency_overrides mechanism, achieving full isolation
    without touching global state between tests.
    """

    def __init__(self) -> None:
        self._records: list[dict[str, Any]] = []

    def append(self, event_type: str, payload: dict[str, Any]) -> None:
        """Record a processed event without mutating the caller's payload."""
        self._records.append({"type": event_type, "payload": payload})

    def count(self) -> int:
        """Return the number of recorded events."""
        return len(self._records)

    def all(self) -> list[dict[str, Any]]:
        """Return a snapshot of all recorded events.

        Returns a new list so callers cannot mutate the internal store state.
        """
        return list(self._records)


# Module-level default store — shared across requests unless overridden via DI.
_default_store = EventStore()


def get_event_store() -> EventStore:
    """FastAPI dependency provider for the event store.

    Override via ``app.dependency_overrides[get_event_store]`` in tests to
    inject a fresh, isolated EventStore per test case.
    """
    return _default_store


# ---------------------------------------------------------------------------
# DORA event store — separate store backed by the configured persistence layer.
# Override via ``app.dependency_overrides[get_dora_store]`` in tests.
# ---------------------------------------------------------------------------

_dora_event_store = create_event_store()


def get_dora_store() -> Any:
    """FastAPI dependency provider for the DORA metrics event store.

    Override via ``app.dependency_overrides[get_dora_store]`` in tests to
    inject a pre-seeded store for DORA computation.
    """
    return _dora_event_store


# ---------------------------------------------------------------------------
# DORA scrape-time collector
# ---------------------------------------------------------------------------

_DORA_WINDOW_DAYS = 30


def collect_dora_metrics(store: Any, repo: str, environment: str) -> None:
    """Compute all four DORA metrics and set the corresponding Prometheus gauges.

    Called at scrape time so that each /metrics request reflects the current
    state of the event store.  Uses set-semantics (not increment) so repeated
    calls are idempotent — subsequent calls overwrite previous values.

    Args:
        store:       EventStore to query for deployment and PR events.
        repo:        Repository full name label (e.g. 'org/repo').
        environment: Environment label (e.g. 'production').
    """
    df = compute_deployment_frequency(store, repo, environment)
    lt = compute_lead_time_for_changes(store, repo, environment)
    cfr = compute_change_failure_rate(store, repo, environment)
    mttr = compute_mttr(store, repo, environment)

    DEPLOYMENT_FREQUENCY_GAUGE.labels(repository=repo, environment=environment).set(df)
    LEAD_TIME_GAUGE.labels(repository=repo, environment=environment).set(lt)
    CHANGE_FAILURE_RATE_GAUGE.labels(repository=repo, environment=environment).set(cfr)
    MTTR_GAUGE.labels(repository=repo, environment=environment).set(mttr)


# ---------------------------------------------------------------------------
# Dispatch logic — pure function, testable without HTTP layer
# ---------------------------------------------------------------------------


def dispatch_event(
    event_type: str,
    payload: dict[str, Any],
    store: EventStore,
) -> dict[str, Any]:
    """Route a GitHub webhook event to its handler.

    Returns a result dict with 'status', 'dispatched', and 'event' keys.

    Unsupported event types are handled gracefully — logged at DEBUG only,
    never WARNING or above. GitHub retries deliveries that receive non-2xx
    responses, so unsupported events must never raise exceptions or return
    error status.
    """
    if event_type in SUPPORTED_EVENTS:
        store.append(event_type, payload)
        logger.info("Dispatched supported event: %s", event_type)
        return {"status": "ok", "dispatched": True, "event": event_type}

    logger.debug("Received unsupported event type: %s — ignoring", event_type)
    return {"status": "ok", "dispatched": False, "event": event_type}


# ---------------------------------------------------------------------------
# Lifespan — hydrates DORA counters from the persisted event store on startup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001
    """Replay stored events into Prometheus counters so /metrics reflects history.

    Runs once during application startup.  After the counters are seeded the
    service starts normally; no action is taken on shutdown.
    """
    store = create_event_store()
    replay_counters_from_store(store, PUSH_COUNTER, PR_COUNTER, DEPLOYMENT_COUNTER)
    yield


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(title="GitWeave Metrics & Webhook Service", lifespan=lifespan)


@app.post("/webhook")
async def webhook(
    payload: dict[str, Any],
    x_github_event: str | None = Header(default=None),
    store: EventStore = Depends(get_event_store),
) -> dict[str, Any]:
    """Receive and dispatch GitHub webhook events.

    Dispatches on the X-GitHub-Event header value. Unsupported event types
    return 200 (not 4xx) to prevent GitHub retry loops for unhandled types.
    A missing or empty header returns 400 — GitHub always sets this header,
    so its absence indicates a malformed request.
    """
    if not x_github_event:
        raise HTTPException(
            status_code=400,
            detail="Missing required X-GitHub-Event header",
        )
    return dispatch_event(x_github_event, payload, store)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Health check endpoint. Always returns 200 — no authentication required.

    Kubernetes liveness and readiness probes must always be able to reach this
    endpoint; gating it on auth or any application state would cause spurious
    pod restarts.
    """
    return {"status": "ok"}


@app.get("/metrics")
async def metrics(store: Any = Depends(get_dora_store)) -> Response:
    """Prometheus exposition format metrics endpoint.

    At scrape time, enumerates all active (repo, environment) pairs from the
    event store and calls collect_dora_metrics for each, updating the four
    DORA Prometheus gauges before serialising the registry.
    """
    since = datetime.now(timezone.utc) - timedelta(days=_DORA_WINDOW_DAYS)
    pairs = store.get_distinct_repo_environment_pairs(since)
    for repo, environment in pairs:
        collect_dora_metrics(store, repo=repo, environment=environment)

    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST,
    )


# ---------------------------------------------------------------------------
# Entry point — server only starts here, never at import time
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
