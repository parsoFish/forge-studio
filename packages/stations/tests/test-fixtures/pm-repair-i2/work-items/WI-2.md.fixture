---
work_item_id: WI-2
initiative_id: INIT-2026-10-11-i2-apply-engine-terraform-retired
status: pending
depends_on:
  - WI-1
domain: auth
acceptance_criteria:
  - given: "GW_APP_ID, GW_APP_PRIVATE_KEY_PATH, GW_APP_INSTALLATION_ID, GW_ORG are all set"
    when: "gitweave.auth.get_github_client() is called"
    then: "returns a PyGithub Github object authenticated as the installation"
  - given: "any one of GW_APP_ID, GW_APP_PRIVATE_KEY_PATH, GW_APP_INSTALLATION_ID, GW_ORG is unset"
    when: "gitweave.auth.get_github_client() is called"
    then: "raises EnvironmentError naming the missing variable"
  - given: "GW_APP_PRIVATE_KEY_PATH points to a file that does not exist"
    when: "gitweave.auth.get_github_client() is called"
    then: "raises FileNotFoundError or EnvironmentError with a descriptive message"
files_in_scope:
  - gitweave/auth.py
  - tests/test_auth.py
creates:
  - gitweave/auth.py
  - tests/test_auth.py
estimated_iterations: 3
quality_gate_cmd:
  - python3
  - -m
  - pytest
  - tests/test_auth.py
---

# WI-2: GitHub App authentication module (gitweave/auth.py)

Target: `gitweave/auth.py` implementing GitHub App authentication. Returns a fully
authenticated `PyGithub.Github` client (installation token); does not return a raw token.

## Implementation spec

```python
# gitweave/auth.py
import os
import time
import jwt                        # PyJWT
from github import Github, Auth   # PyGithub >= 2.3

REQUIRED_ENV = ["GW_APP_ID", "GW_APP_PRIVATE_KEY_PATH",
                "GW_APP_INSTALLATION_ID", "GW_ORG"]

def _check_env() -> dict:
    """Return env dict; raise EnvironmentError naming first missing var."""
    missing = [v for v in REQUIRED_ENV if not os.environ.get(v)]
    if missing:
        raise EnvironmentError(
            f"Missing required environment variable(s): {', '.join(missing)}"
        )
    return {v: os.environ[v] for v in REQUIRED_ENV}

def _make_jwt(app_id: str, private_key_path: str) -> str:
    """Generate a GitHub App JWT valid for 60 s."""
    pem = open(private_key_path, "rb").read()   # raises FileNotFoundError if absent
    now = int(time.time())
    payload = {"iat": now - 60, "exp": now + 600, "iss": app_id}
    return jwt.encode(payload, pem, algorithm="RS256")

def get_github_client() -> Github:
    """Return an installation-authenticated Github client."""
    env = _check_env()
    app_jwt = _make_jwt(env["GW_APP_ID"], env["GW_APP_PRIVATE_KEY_PATH"])
    auth = Auth.AppInstallationAuth(
        app_id=int(env["GW_APP_ID"]),
        private_key=open(env["GW_APP_PRIVATE_KEY_PATH"], "rb").read(),
        installation_id=int(env["GW_APP_INSTALLATION_ID"]),
    )
    return Github(auth=auth)
```

`PyGithub >= 2.3` exposes `github.Auth.AppInstallationAuth`; do not hand-roll the
token exchange (pattern: avoid-hand-rolling-tools).

## tests/test_auth.py

Tests MUST be credential-free (all network calls mocked). Use `unittest.mock.patch` to
mock `Github` and the JWT/key reading so tests run without real keys or network.

Key test cases:
1. All env vars set → `get_github_client()` returns a `Github` instance.
2. One env var missing → raises `EnvironmentError` containing the missing variable name.
3. All env vars missing → raises `EnvironmentError` (message lists all missing).
4. Private key file absent → `FileNotFoundError` or `EnvironmentError` with descriptive msg.

---

Brain themes consulted:
- `brain/projects/gitweave/profile.md`
- `brain/cycles/themes/spec-driven-work-items.md`
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md`
