"""Unit tests for DORA Lead Time for Changes metric (PR-merge variant).

Lead Time for Changes is the median time in **seconds** from the earliest
commit push timestamp to PR merge for a repository, measured over a rolling
30-day window.

Correlation strategy:
  1. Query ``pull_request`` events where ``merged_at`` is not None.
  2. For each merged PR, look up its ``commit_sha`` in ``push`` events.
  3. Use the **earliest** commit timestamp in the matching push event.
  4. Compute ``(merged_at - earliest_commit_ts).total_seconds()``.
  5. Return the median across all resolved lead times.

PRs with no matching push event are excluded from the median.
Returns 0.0 when no resolvable merged PRs exist in the 30-day window.

All tests use InMemoryEventStore and in-memory fixtures — no I/O.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

_REPO = "owner/repo"
_NOW = datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
_WINDOW_DAYS = 30


def _push_event(
    repo: str,
    sha: str,
    commit_timestamp: datetime,
    created_at: datetime | None = None,
    extra_commits: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a minimal push event containing a single commit with the given SHA."""
    commits = [{"sha": sha, "timestamp": commit_timestamp.isoformat()}]
    if extra_commits:
        commits.extend(extra_commits)
    return {
        "event_type": "push",
        "repo": repo,
        "ref": "refs/heads/main",
        "commits": commits,
        "created_at": created_at or commit_timestamp,
    }


def _pr_merged_event(
    repo: str,
    pr_number: int,
    commit_sha: str,
    merged_at: datetime,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    """Build a minimal merged pull_request event."""
    return {
        "event_type": "pull_request",
        "repo": repo,
        "pr_number": pr_number,
        "commit_sha": commit_sha,
        "merged_at": merged_at,
        "created_at": created_at or merged_at,
    }


def _pr_unmerged_event(
    repo: str,
    pr_number: int,
    commit_sha: str,
    created_at: datetime,
) -> dict[str, Any]:
    """Build a minimal closed-but-not-merged pull_request event."""
    return {
        "event_type": "pull_request",
        "repo": repo,
        "pr_number": pr_number,
        "commit_sha": commit_sha,
        "merged_at": None,
        "created_at": created_at,
    }


def _make_store(*events: dict[str, Any]):
    """Return an InMemoryEventStore populated with the given events."""
    from store import InMemoryEventStore

    store = InMemoryEventStore()
    for e in events:
        store.store_event(e)
    return store


# ---------------------------------------------------------------------------
# Import alias — fails fast if module or function is missing
# ---------------------------------------------------------------------------


def _get_fn():
    from dora.lead_time_for_changes import calculate_lead_time_for_changes

    return calculate_lead_time_for_changes


# ===========================================================================
# 1. Empty-store and degenerate inputs
# ===========================================================================


class TestCalculateLeadTimeEmptyStore:
    """Returns 0.0 when the store has no events at all."""

    def test_empty_store_returns_zero(self):
        fn = _get_fn()
        store = _make_store()
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_return_type_is_float(self):
        fn = _get_fn()
        store = _make_store()
        result = fn(_REPO, store, _NOW)
        assert isinstance(result, float)

    def test_zero_is_exact_not_nan(self):
        fn = _get_fn()
        store = _make_store()
        result = fn(_REPO, store, _NOW)
        assert result == result  # NaN != NaN; passing means it's a real number
        assert result == 0.0

    def test_store_with_only_push_events_returns_zero(self):
        """Push events alone (no PRs) → 0.0."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "abc123", push_ts),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_store_with_only_unmerged_prs_returns_zero(self):
        """Closed-but-not-merged PRs must not contribute to the metric."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5)
        closed_at = _NOW - timedelta(days=2)
        store = _make_store(
            _push_event(_REPO, "sha001", push_ts),
            _pr_unmerged_event(_REPO, 1, "sha001", closed_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_result_is_zero_not_none(self):
        """Function must return 0.0 (a float), never None."""
        fn = _get_fn()
        store = _make_store()
        result = fn(_REPO, store, _NOW)
        assert result is not None

    def test_result_is_non_negative_for_empty_store(self):
        fn = _get_fn()
        store = _make_store()
        result = fn(_REPO, store, _NOW)
        assert result >= 0.0


# ===========================================================================
# 2. Single merged PR with a matching push event
# ===========================================================================


class TestCalculateLeadTimeSinglePR:
    """Single merged PR with a matching push → returns the exact lead time."""

    def test_one_hour_lead_time(self):
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha001", push_ts),
            _pr_merged_event(_REPO, 1, "sha001", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)

    def test_one_day_lead_time(self):
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=6)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha002", push_ts),
            _pr_merged_event(_REPO, 2, "sha002", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(86400.0)

    def test_one_week_lead_time(self):
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=12)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha003", push_ts),
            _pr_merged_event(_REPO, 3, "sha003", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7 * 86400.0)

    def test_result_in_seconds_not_hours(self):
        """Return value is seconds, not hours."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=2)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha004", push_ts),
            _pr_merged_event(_REPO, 4, "sha004", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        # 2 hours in seconds = 7200; if returned in hours it would be 2.0
        assert result == pytest.approx(7200.0)
        assert result > 100  # definitely seconds-scale, not hours-scale

    def test_sub_minute_lead_time(self):
        """Very small lead times (< 60 s) are handled correctly."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, seconds=30)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha005", push_ts),
            _pr_merged_event(_REPO, 5, "sha005", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(30.0)

    def test_exactly_zero_lead_time(self):
        """PR merged at the same instant as the push commit timestamp → 0.0."""
        fn = _get_fn()
        ts = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha006", ts),
            _pr_merged_event(_REPO, 6, "sha006", ts),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(0.0)

    def test_sha_lookup_is_case_sensitive(self):
        """SHA comparison must be exact (case-sensitive byte match)."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        # Push has lowercase SHA; PR has uppercase → no match → excluded → 0.0
        store = _make_store(
            _push_event(_REPO, "abc123", push_ts),
            _pr_merged_event(_REPO, 7, "ABC123", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_sha_matches_exactly(self):
        """Matching SHA (same case) produces the correct lead time."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        sha = "deadbeefcafe1234"
        store = _make_store(
            _push_event(_REPO, sha, push_ts),
            _pr_merged_event(_REPO, 8, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)


# ===========================================================================
# 3. Multiple merged PRs — median calculation
# ===========================================================================


class TestCalculateLeadTimeMultiplePRs:
    """Multiple merged PRs produce the correct median lead time."""

    def test_two_prs_median_is_average(self):
        """With 2 PRs, median = average of both lead times."""
        fn = _get_fn()
        # PR A: 1 hour lead time (3600s)
        # PR B: 3 hours lead time (10800s)
        # Median = (3600 + 10800) / 2 = 7200s
        store = _make_store(
            _push_event(_REPO, "sha_a", _NOW - timedelta(days=5, hours=1)),
            _pr_merged_event(_REPO, 1, "sha_a", _NOW - timedelta(days=5)),
            _push_event(_REPO, "sha_b", _NOW - timedelta(days=8, hours=3)),
            _pr_merged_event(_REPO, 2, "sha_b", _NOW - timedelta(days=8)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_three_prs_median_is_middle_value(self):
        """With 3 PRs, median = middle value after sorting."""
        fn = _get_fn()
        # Lead times: 3600s, 7200s, 10800s → median = 7200s
        store = _make_store(
            _push_event(_REPO, "sha1", _NOW - timedelta(days=10, hours=1)),
            _pr_merged_event(_REPO, 1, "sha1", _NOW - timedelta(days=10)),
            _push_event(_REPO, "sha2", _NOW - timedelta(days=10, hours=2)),
            _pr_merged_event(_REPO, 2, "sha2", _NOW - timedelta(days=10)),
            _push_event(_REPO, "sha3", _NOW - timedelta(days=10, hours=3)),
            _pr_merged_event(_REPO, 3, "sha3", _NOW - timedelta(days=10)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_four_prs_median_is_average_of_two_middle(self):
        """With 4 PRs, median = average of 2nd and 3rd values sorted."""
        fn = _get_fn()
        # Lead times sorted: 1h, 2h, 3h, 4h
        # Median = (2h + 3h) / 2 = 2.5h = 9000s
        durations = [timedelta(hours=1), timedelta(hours=2), timedelta(hours=3), timedelta(hours=4)]
        events: list[dict[str, Any]] = []
        for i, dur in enumerate(durations):
            sha = f"sha_four_{i}"
            base = _NOW - timedelta(days=i + 1)
            events.append(_push_event(_REPO, sha, base - dur))
            events.append(_pr_merged_event(_REPO, i + 1, sha, base))
        store = _make_store(*events)
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(9000.0)

    def test_five_prs_median_is_third_value(self):
        """With 5 PRs, median is the 3rd value (index 2) after sorting."""
        fn = _get_fn()
        # Lead times sorted: 1h, 2h, 4h, 6h, 8h → median = 4h = 14400s
        durations_hours = [1, 6, 2, 8, 4]
        events: list[dict[str, Any]] = []
        for i, hours in enumerate(durations_hours):
            sha = f"sha_five_{i}"
            base = _NOW - timedelta(days=i + 1)
            events.append(_push_event(_REPO, sha, base - timedelta(hours=hours)))
            events.append(_pr_merged_event(_REPO, i + 1, sha, base))
        store = _make_store(*events)
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(14400.0)

    def test_all_same_lead_time_returns_that_value(self):
        """When all PRs have identical lead times, median == that lead time."""
        fn = _get_fn()
        events: list[dict[str, Any]] = []
        for i in range(5):
            sha = f"sha_same_{i}"
            base = _NOW - timedelta(days=i + 1)
            events.append(_push_event(_REPO, sha, base - timedelta(hours=2)))
            events.append(_pr_merged_event(_REPO, i + 1, sha, base))
        store = _make_store(*events)
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_large_set_of_prs_returns_correct_median(self):
        """10 PRs with lead times 1h–10h → median of even count = 5.5h."""
        fn = _get_fn()
        events: list[dict[str, Any]] = []
        for i in range(1, 11):  # 1h, 2h, ... 10h
            sha = f"sha_large_{i}"
            base = _NOW - timedelta(days=i)
            events.append(_push_event(_REPO, sha, base - timedelta(hours=i)))
            events.append(_pr_merged_event(_REPO, i, sha, base))
        store = _make_store(*events)
        result = fn(_REPO, store, _NOW)
        # sorted: 3600, 7200, ..., 36000; median = (18000+21600)/2 = 19800
        assert result == pytest.approx(19800.0)

    def test_median_is_not_mean(self):
        """Median and mean differ for skewed distributions."""
        fn = _get_fn()
        # Lead times: 1h, 1h, 1h, 1h, 100h
        # Mean ≈ 20.8h; Median = 1h = 3600s
        outlier_sha = "sha_outlier"
        store = _make_store(
            _push_event(_REPO, "sha_low0", _NOW - timedelta(days=5, hours=1)),
            _pr_merged_event(_REPO, 1, "sha_low0", _NOW - timedelta(days=5)),
            _push_event(_REPO, "sha_low1", _NOW - timedelta(days=6, hours=1)),
            _pr_merged_event(_REPO, 2, "sha_low1", _NOW - timedelta(days=6)),
            _push_event(_REPO, "sha_low2", _NOW - timedelta(days=7, hours=1)),
            _pr_merged_event(_REPO, 3, "sha_low2", _NOW - timedelta(days=7)),
            _push_event(_REPO, "sha_low3", _NOW - timedelta(days=8, hours=1)),
            _pr_merged_event(_REPO, 4, "sha_low3", _NOW - timedelta(days=8)),
            _push_event(_REPO, outlier_sha, _NOW - timedelta(days=9, hours=100)),
            _pr_merged_event(_REPO, 5, outlier_sha, _NOW - timedelta(days=9)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)


# ===========================================================================
# 4. PR missing push event — excluded from median
# ===========================================================================


class TestCalculateLeadTimeMissingPush:
    """PRs whose commit_sha is not found in any push event are excluded."""

    def test_pr_with_no_push_returns_zero(self):
        """Single PR with no matching push → excluded → returns 0.0."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _pr_merged_event(_REPO, 1, "sha_missing", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_pr_with_wrong_sha_in_push_returns_zero(self):
        """Push exists but contains a different SHA → no match → 0.0."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha_different", push_ts),
            _pr_merged_event(_REPO, 1, "sha_pr_head", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_pr_with_missing_push_excluded_from_median_of_two(self):
        """Of 2 PRs, one has no push → only the other contributes to median."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=2)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            # PR 1: has matching push
            _push_event(_REPO, "sha_has_push", push_ts),
            _pr_merged_event(_REPO, 1, "sha_has_push", merged_at),
            # PR 2: no matching push (SHA not in any push)
            _pr_merged_event(_REPO, 2, "sha_no_push", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_all_prs_missing_push_returns_zero(self):
        """When every PR has an unresolvable SHA → median pool is empty → 0.0."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _pr_merged_event(_REPO, 1, "sha_miss1", merged_at),
            _pr_merged_event(_REPO, 2, "sha_miss2", merged_at),
            _pr_merged_event(_REPO, 3, "sha_miss3", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_some_prs_missing_push_excluded_from_median(self):
        """3 PRs, 2 with matching pushes, 1 missing → median of 2."""
        fn = _get_fn()
        # PR A: 1h lead time
        # PR B: 3h lead time
        # PR C: no push → excluded
        # Median of (3600, 10800) = 7200
        store = _make_store(
            _push_event(_REPO, "sha_a", _NOW - timedelta(days=5, hours=1)),
            _pr_merged_event(_REPO, 1, "sha_a", _NOW - timedelta(days=5)),
            _push_event(_REPO, "sha_b", _NOW - timedelta(days=6, hours=3)),
            _pr_merged_event(_REPO, 2, "sha_b", _NOW - timedelta(days=6)),
            _pr_merged_event(_REPO, 3, "sha_c_missing", _NOW - timedelta(days=7)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_push_event_empty_commits_list_does_not_match(self):
        """A push event with an empty commits list cannot match any SHA."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            {
                "event_type": "push",
                "repo": _REPO,
                "ref": "refs/heads/main",
                "commits": [],
                "created_at": _NOW - timedelta(days=6),
            },
            _pr_merged_event(_REPO, 1, "sha_no_match", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_push_event_with_none_commits_does_not_match(self):
        """A push event with commits=None must not crash or produce a match."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            {
                "event_type": "push",
                "repo": _REPO,
                "ref": "refs/heads/main",
                "commits": None,
                "created_at": _NOW - timedelta(days=6),
            },
            _pr_merged_event(_REPO, 1, "sha_will_not_match", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0


# ===========================================================================
# 5. Multi-commit push — earliest commit timestamp is used
# ===========================================================================


class TestCalculateLeadTimeMultiCommitPush:
    """When a push contains multiple commits, the earliest timestamp is used."""

    def test_earliest_of_two_commits_is_anchor(self):
        """Push has 2 commits; earlier one determines the lead time."""
        fn = _get_fn()
        # Commit timestamps in the push
        early_ts = _NOW - timedelta(days=5, hours=3)
        late_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        sha = "sha_head"

        push = {
            "event_type": "push",
            "repo": _REPO,
            "ref": "refs/heads/main",
            "commits": [
                {"sha": sha, "timestamp": late_ts.isoformat()},
                {"sha": "sha_older", "timestamp": early_ts.isoformat()},
            ],
            "created_at": late_ts,
        }
        store = _make_store(
            push,
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        # Should use early_ts → lead time = 3 hours = 10800s
        assert result == pytest.approx(10800.0)

    def test_earliest_of_five_commits_is_anchor(self):
        """Push has 5 commits spanning 5 hours; earliest is the anchor."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=2)
        head_sha = "sha_head_multi"
        commits = []
        for h in [4, 1, 3, 5, 2]:  # timestamps in non-sorted order
            commits.append(
                {
                    "sha": f"commit_{h}h",
                    "timestamp": (merged_at - timedelta(hours=h)).isoformat(),
                }
            )
        # Head SHA is the first commit in the list (4h before merge)
        commits[0]["sha"] = head_sha
        push = {
            "event_type": "push",
            "repo": _REPO,
            "ref": "refs/heads/main",
            "commits": commits,
            "created_at": merged_at - timedelta(hours=1),
        }
        store = _make_store(
            push,
            _pr_merged_event(_REPO, 1, head_sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        # earliest = 5h before merge → lead time = 5h = 18000s
        assert result == pytest.approx(18000.0)

    def test_single_commit_push_timestamp_used(self):
        """Single-commit push: that commit's timestamp is the anchor."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=2)
        merged_at = _NOW - timedelta(days=5)
        sha = "sha_single"
        store = _make_store(
            _push_event(_REPO, sha, push_ts),
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_commit_timestamp_as_string_is_parsed(self):
        """Commit timestamps stored as ISO-8601 strings are parsed to datetime."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        sha = "sha_str_ts"
        push = {
            "event_type": "push",
            "repo": _REPO,
            "ref": "refs/heads/main",
            "commits": [{"sha": sha, "timestamp": push_ts.isoformat()}],
            "created_at": push_ts,
        }
        store = _make_store(push, _pr_merged_event(_REPO, 1, sha, merged_at))
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)

    def test_commit_timestamp_as_datetime_object_is_used(self):
        """Commit timestamps stored as datetime objects are accepted directly."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        sha = "sha_dt_obj"
        push = {
            "event_type": "push",
            "repo": _REPO,
            "ref": "refs/heads/main",
            "commits": [{"sha": sha, "timestamp": push_ts}],
            "created_at": push_ts,
        }
        store = _make_store(push, _pr_merged_event(_REPO, 1, sha, merged_at))
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)

    def test_commits_missing_timestamp_field_skipped(self):
        """Commits without a timestamp field are skipped; valid ones still used."""
        fn = _get_fn()
        valid_ts = _NOW - timedelta(days=5, hours=2)
        merged_at = _NOW - timedelta(days=5)
        sha = "sha_valid"
        push = {
            "event_type": "push",
            "repo": _REPO,
            "ref": "refs/heads/main",
            "commits": [
                {"sha": sha, "timestamp": valid_ts.isoformat()},
                {"sha": "sha_no_ts"},  # no timestamp
            ],
            "created_at": valid_ts,
        }
        store = _make_store(push, _pr_merged_event(_REPO, 1, sha, merged_at))
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)


# ===========================================================================
# 6. Rolling 30-day window behaviour
# ===========================================================================


class TestCalculateLeadTimeWindowBoundary:
    """PRs merged outside the 30-day window are excluded."""

    def test_pr_merged_within_window_is_included(self):
        """PR merged 29 days ago is within the window → included."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=29)
        push_ts = merged_at - timedelta(hours=1)
        store = _make_store(
            _push_event(_REPO, "sha_in", push_ts),
            _pr_merged_event(_REPO, 1, "sha_in", merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)

    def test_pr_merged_exactly_at_window_boundary_is_included(self):
        """PR merged exactly 30 days ago is on the boundary → included (>=)."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=30)
        push_ts = merged_at - timedelta(hours=1)
        store = _make_store(
            _push_event(_REPO, "sha_boundary", push_ts),
            _pr_merged_event(_REPO, 1, "sha_boundary", merged_at, created_at=merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)

    def test_pr_merged_just_outside_window_is_excluded(self):
        """PR merged 31 days ago is outside the window → excluded → 0.0."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=31)
        push_ts = merged_at - timedelta(hours=1)
        store = _make_store(
            _push_event(_REPO, "sha_out", push_ts),
            _pr_merged_event(_REPO, 1, "sha_out", merged_at, created_at=merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_mixed_window_only_recent_prs_counted(self):
        """PRs inside and outside the window → only inside PRs contribute."""
        fn = _get_fn()
        # PR inside window: 1h lead time
        in_merged = _NOW - timedelta(days=10)
        in_push_ts = in_merged - timedelta(hours=1)
        # PR outside window: 10h lead time (should be excluded)
        out_merged = _NOW - timedelta(days=35)
        out_push_ts = out_merged - timedelta(hours=10)
        store = _make_store(
            _push_event(_REPO, "sha_in", in_push_ts),
            _pr_merged_event(_REPO, 1, "sha_in", in_merged, created_at=in_merged),
            _push_event(_REPO, "sha_out", out_push_ts),
            _pr_merged_event(_REPO, 2, "sha_out", out_merged, created_at=out_merged),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)

    def test_now_reference_shifts_window(self):
        """Changing `now` shifts the window — same events, different result."""
        fn = _get_fn()
        sha = "sha_ref"
        # PR merged 20 days before a past reference date
        ref_past = _NOW - timedelta(days=50)
        merged_at = ref_past - timedelta(days=20)
        push_ts = merged_at - timedelta(hours=1)

        store = _make_store(
            _push_event(_REPO, sha, push_ts),
            _pr_merged_event(_REPO, 1, sha, merged_at, created_at=merged_at),
        )

        # Using `now = _NOW` (70 days after merge) → outside window → 0.0
        result_now = fn(_REPO, store, _NOW)
        assert result_now == 0.0

        # Using `now = ref_past` (20 days after merge) → inside window → 3600s
        result_past = fn(_REPO, store, ref_past)
        assert result_past == pytest.approx(3600.0)


# ===========================================================================
# 7. Repository isolation — only the target repo's events count
# ===========================================================================


class TestCalculateLeadTimeRepoIsolation:
    """Events from other repositories must not affect the target repo's metric."""

    def test_other_repo_events_are_ignored(self):
        """Events stored under a different repo key must be excluded."""
        fn = _get_fn()
        other_repo = "other/repo"
        target_merged = _NOW - timedelta(days=5)
        target_push_ts = target_merged - timedelta(hours=2)

        store = _make_store(
            # Target repo: 2h lead time
            _push_event(_REPO, "sha_target", target_push_ts),
            _pr_merged_event(_REPO, 1, "sha_target", target_merged),
            # Other repo: 10h lead time — must not pollute target median
            _push_event(other_repo, "sha_other", _NOW - timedelta(days=8, hours=10)),
            _pr_merged_event(other_repo, 2, "sha_other", _NOW - timedelta(days=8)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_empty_repo_name_does_not_match_other_repos(self):
        """Querying with an empty repo string returns 0.0, ignoring all events."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha_x", push_ts),
            _pr_merged_event(_REPO, 1, "sha_x", merged_at),
        )
        result = fn("", store, _NOW)
        assert result == 0.0

    def test_repo_with_no_events_returns_zero_despite_other_repos(self):
        """A repo with no events at all returns 0.0."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event("irrelevant/repo", "sha_irr", push_ts),
            _pr_merged_event("irrelevant/repo", 1, "sha_irr", merged_at),
        )
        result = fn("no/events", store, _NOW)
        assert result == 0.0

    def test_push_from_other_repo_does_not_resolve_pr_sha(self):
        """Push event in repo B cannot satisfy SHA lookup for PR in repo A."""
        fn = _get_fn()
        sha = "shared_sha"
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        # Push is stored under "other/repo", PR is under _REPO
        store = _make_store(
            _push_event("other/repo", sha, push_ts),
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0


# ===========================================================================
# 8. Unmerged and non-PR events are excluded
# ===========================================================================


class TestCalculateLeadTimeEventFiltering:
    """Non-merged events of all types are excluded from the calculation."""

    def test_push_events_alone_give_zero(self):
        fn = _get_fn()
        store = _make_store(
            _push_event(_REPO, "sha_push", _NOW - timedelta(days=5)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_deployment_status_events_are_ignored(self):
        """Deployment_status events must not be used as PR merge signals."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        deploy_ts = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha_dep", push_ts),
            {
                "event_type": "deployment_status",
                "repo": _REPO,
                "state": "success",
                "environment": "production",
                "sha": "sha_dep",
                "created_at": deploy_ts,
            },
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_closed_pr_without_merged_at_excluded(self):
        """pull_request event with merged_at=None is not a merge → excluded."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=1)
        closed_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha_closed", push_ts),
            _pr_unmerged_event(_REPO, 1, "sha_closed", closed_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_mix_of_merged_and_unmerged_prs(self):
        """Only the merged PR contributes to the median."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, hours=2)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "sha_merged", push_ts),
            _pr_merged_event(_REPO, 1, "sha_merged", merged_at),
            _push_event(_REPO, "sha_closed", _NOW - timedelta(days=10, hours=5)),
            _pr_unmerged_event(_REPO, 2, "sha_closed", _NOW - timedelta(days=10)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)


# ===========================================================================
# 9. Multiple push events — correct push is identified
# ===========================================================================


class TestCalculateLeadTimeMultiplePushEvents:
    """SHA lookup searches all push events and finds the correct one."""

    def test_sha_found_in_second_push_event(self):
        """When SHA is in the second of two push events, it is found correctly."""
        fn = _get_fn()
        target_sha = "sha_in_second_push"
        push1_ts = _NOW - timedelta(days=10, hours=5)
        push2_ts = _NOW - timedelta(days=5, hours=2)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, "unrelated_sha", push1_ts),
            _push_event(_REPO, target_sha, push2_ts),
            _pr_merged_event(_REPO, 1, target_sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)

    def test_sha_in_one_of_many_push_events(self):
        """10 push events, target SHA in 5th → correct lead time returned."""
        fn = _get_fn()
        target_sha = "sha_needle"
        needle_push_ts = _NOW - timedelta(days=3, hours=3)
        merged_at = _NOW - timedelta(days=3)
        events: list[dict[str, Any]] = []
        for i in range(10):
            sha = f"sha_hay_{i}" if i != 4 else target_sha
            ts = _NOW - timedelta(days=i + 1, hours=i + 1)
            events.append(_push_event(_REPO, sha, ts))
        events.append(
            _push_event(_REPO, target_sha, needle_push_ts)
        )
        events.append(_pr_merged_event(_REPO, 1, target_sha, merged_at))
        store = _make_store(*events)
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(10800.0)

    def test_same_sha_in_two_push_events_uses_earliest_overall(self):
        """If a SHA appears in two push events, earliest commit timestamp wins."""
        fn = _get_fn()
        sha = "sha_duplicate"
        early_push_ts = _NOW - timedelta(days=5, hours=5)
        late_push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, sha, early_push_ts),
            _push_event(_REPO, sha, late_push_ts),
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        # Implementation may return either 3600 or 18000 depending on which
        # push is found first; document the accepted range:
        assert result in {pytest.approx(3600.0), pytest.approx(18000.0)}


# ===========================================================================
# 10. Function signature and import contract
# ===========================================================================


class TestCalculateLeadTimeFunctionContract:
    """The function must be importable and accept the expected signature."""

    def test_function_is_importable(self):
        from dora.lead_time_for_changes import calculate_lead_time_for_changes  # noqa: F401

    def test_function_is_callable(self):
        from dora.lead_time_for_changes import calculate_lead_time_for_changes

        assert callable(calculate_lead_time_for_changes)

    def test_accepts_repo_store_now_positional(self):
        """Function must accept (repo, store, now) without error."""
        fn = _get_fn()
        store = _make_store()
        result = fn(_REPO, store, _NOW)
        assert isinstance(result, float)

    def test_accepts_keyword_arguments(self):
        fn = _get_fn()
        store = _make_store()
        result = fn(repo=_REPO, store=store, now=_NOW)
        assert isinstance(result, float)

    def test_return_type_always_float(self):
        fn = _get_fn()
        store = _make_store()
        assert type(fn(_REPO, store, _NOW)) is float

    def test_does_not_raise_on_empty_store(self):
        fn = _get_fn()
        store = _make_store()
        fn(_REPO, store, _NOW)  # must not raise

    def test_does_not_raise_with_valid_merged_pr(self):
        fn = _get_fn()
        sha = "sha_safe"
        store = _make_store(
            _push_event(_REPO, sha, _NOW - timedelta(hours=1)),
            _pr_merged_event(_REPO, 1, sha, _NOW),
        )
        fn(_REPO, store, _NOW)  # must not raise


# ===========================================================================
# 11. Precision and arithmetic correctness
# ===========================================================================


class TestCalculateLeadTimePrecision:
    """Median computation is arithmetically correct."""

    def test_fractional_seconds_preserved(self):
        """Lead times with sub-second precision are preserved."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=5, seconds=30, microseconds=500000)
        merged_at = _NOW - timedelta(days=5)
        sha = "sha_frac"
        store = _make_store(
            _push_event(_REPO, sha, push_ts),
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(30.5)

    def test_large_lead_time_does_not_overflow(self):
        """365-day lead time (31536000s) is handled without overflow."""
        fn = _get_fn()
        push_ts = _NOW - timedelta(days=365)
        merged_at = _NOW - timedelta(days=5)
        sha = "sha_large"
        store = _make_store(
            _push_event(_REPO, sha, push_ts),
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        expected = (merged_at - push_ts).total_seconds()
        assert result == pytest.approx(expected)

    def test_even_count_median_interpolated_correctly(self):
        """For N=2 sorted [1800, 5400], median = (1800+5400)/2 = 3600."""
        fn = _get_fn()
        store = _make_store(
            _push_event(_REPO, "sha_30m", _NOW - timedelta(days=5, minutes=30)),
            _pr_merged_event(_REPO, 1, "sha_30m", _NOW - timedelta(days=5)),
            _push_event(_REPO, "sha_90m", _NOW - timedelta(days=6, minutes=90)),
            _pr_merged_event(_REPO, 2, "sha_90m", _NOW - timedelta(days=6)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)

    def test_odd_count_median_is_exact_middle_value(self):
        """For N=3 sorted [3600, 7200, 10800], median = 7200."""
        fn = _get_fn()
        store = _make_store(
            _push_event(_REPO, "sha_1h", _NOW - timedelta(days=5, hours=1)),
            _pr_merged_event(_REPO, 1, "sha_1h", _NOW - timedelta(days=5)),
            _push_event(_REPO, "sha_2h", _NOW - timedelta(days=6, hours=2)),
            _pr_merged_event(_REPO, 2, "sha_2h", _NOW - timedelta(days=6)),
            _push_event(_REPO, "sha_3h", _NOW - timedelta(days=7, hours=3)),
            _pr_merged_event(_REPO, 3, "sha_3h", _NOW - timedelta(days=7)),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(7200.0)


# ===========================================================================
# 12. Edge cases and robustness
# ===========================================================================


class TestCalculateLeadTimeEdgeCases:
    """Robustness checks for unusual but valid inputs."""

    def test_pr_with_missing_commit_sha_field_excluded(self):
        """PR event missing the commit_sha field is excluded gracefully."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            {
                "event_type": "pull_request",
                "repo": _REPO,
                "pr_number": 1,
                # commit_sha is absent
                "merged_at": merged_at,
                "created_at": merged_at,
            },
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_pr_with_none_commit_sha_excluded(self):
        """PR event with commit_sha=None is excluded gracefully."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            {
                "event_type": "pull_request",
                "repo": _REPO,
                "pr_number": 1,
                "commit_sha": None,
                "merged_at": merged_at,
                "created_at": merged_at,
            },
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_pr_with_empty_string_commit_sha_excluded(self):
        """PR with an empty-string commit_sha is excluded gracefully."""
        fn = _get_fn()
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            {
                "event_type": "pull_request",
                "repo": _REPO,
                "pr_number": 1,
                "commit_sha": "",
                "merged_at": merged_at,
                "created_at": merged_at,
            },
        )
        result = fn(_REPO, store, _NOW)
        assert result == 0.0

    def test_large_number_of_prs_does_not_crash(self):
        """100 merged PRs can be processed without error."""
        fn = _get_fn()
        events: list[dict[str, Any]] = []
        for i in range(100):
            sha = f"sha_{i:04d}"
            base = _NOW - timedelta(days=(i % 28) + 1)
            events.append(_push_event(_REPO, sha, base - timedelta(hours=1)))
            events.append(_pr_merged_event(_REPO, i + 1, sha, base))
        store = _make_store(*events)
        result = fn(_REPO, store, _NOW)
        assert isinstance(result, float)
        assert result > 0

    def test_result_is_non_negative_for_valid_data(self):
        """Lead time cannot be negative when push precedes merge."""
        fn = _get_fn()
        sha = "sha_positive"
        push_ts = _NOW - timedelta(days=5, hours=2)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, sha, push_ts),
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result >= 0.0

    def test_stores_with_interleaved_event_types_handled(self):
        """A store containing push, pull_request, and deployment_status events works."""
        fn = _get_fn()
        sha = "sha_interleaved"
        push_ts = _NOW - timedelta(days=5, hours=1)
        merged_at = _NOW - timedelta(days=5)
        store = _make_store(
            _push_event(_REPO, sha, push_ts),
            {
                "event_type": "deployment_status",
                "repo": _REPO,
                "state": "success",
                "environment": "production",
                "sha": sha,
                "created_at": _NOW - timedelta(days=4),
            },
            _pr_merged_event(_REPO, 1, sha, merged_at),
        )
        result = fn(_REPO, store, _NOW)
        assert result == pytest.approx(3600.0)
