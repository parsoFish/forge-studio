#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
CHECK_MODE=false
for arg in "$@"; do
    case "$arg" in
        --check)
            CHECK_MODE=true
            ;;
    esac
done

echo "GitWeave Bootstrap"
echo "=================="
echo ""

# ---------------------------------------------------------------------------
# Prerequisite checks  (shared between --check and full run)
# ---------------------------------------------------------------------------
echo "Checking prerequisites..."

_require() {
    local tool="$1"
    if ! command -v "$tool" &> /dev/null; then
        echo "ERROR: $tool is not installed. Please install $tool and re-run." >&2
        exit 1
    fi
    echo "  $tool ... ok"
}

_require git
_require terraform
_require python3
_require docker

# Check Docker daemon is reachable (needed for docker compose up)
echo -n "  docker daemon ... "
if ! docker info &> /dev/null; then
    echo "not running" >&2
    echo "ERROR: Docker daemon is not running. Start Docker and retry." >&2
    exit 1
fi
echo "running"

echo ""

# ---------------------------------------------------------------------------
# --check mode: validate and describe planned actions, then exit
# ---------------------------------------------------------------------------
if [ "$CHECK_MODE" = "true" ]; then
    echo "All prerequisites satisfied."
    echo ""
    echo "Planned actions (none of these are executed in --check mode):"
    echo "  1. docker compose up -d        -- start metrics + postgres stack"
    echo "  2. terraform init              -- initialise Terraform providers in infra/"
    echo "  3. python3 -m venv .venv && pip install -r metrics/requirements.txt"
    echo "                                 -- install Python deps into venv"
    echo ""
    echo "Service URLs (after a full run):"
    echo "  Metrics API  : http://localhost:8000"
    echo "  PostgreSQL   : localhost:5432"
    echo ""
    echo "Run without --check to bring up the full local stack."
    exit 0
fi

# ---------------------------------------------------------------------------
# Full run: bring up the local stack
# ---------------------------------------------------------------------------

# Directory structure
echo "Verifying directory structure..."
REQUIRED_DIRS=("modules" "config" "infra" "metrics" ".github/workflows")
for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        echo "  WARNING: '$dir' missing — creating..."
        mkdir -p "$dir"
    else
        echo "  $dir ... ok"
    fi
done
echo ""

# Metrics stack
echo "Starting metrics stack (docker compose up -d)..."
docker compose -f metrics/docker-compose.yml up -d
echo ""

# Terraform
echo "Initialising Terraform (terraform init)..."
terraform -chdir=infra init
echo ""

# Python venv + deps
echo "Installing Python dependencies..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
.venv/bin/pip install -r metrics/requirements.txt
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "================================"
echo "Bootstrap complete — services available at:"
echo "  Metrics API  : http://localhost:8000"
echo "  PostgreSQL   : localhost:5432"
echo ""
echo "Activate the Python venv with:  source .venv/bin/activate"
