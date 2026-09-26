# GitWeave

**GitWeave** is a single "control" repository that configures and weaves together a GitHub organisation using in-repo modules, overlays, and provider-native tooling.

Instead of building a heavy standalone platform, GitWeave overlays your GitHub organization to provide standardized templates, governance, and observability while leveraging GitHub's native strengths (Actions, Issues, Packages).

## 🚀 Vision

*   **Control Repo Centricity**: Run your entire platform from one core repo.
*   **Provider-Native**: Use GitHub for hosting, CI, Identity, and Work Management.
*   **Platform as Code**: Define behavior via configuration and Terraform, not bespoke services.
*   **Greenfield & Brownfield**: Bootstrap new orgs or safely overlay existing ones.

## Constitution & Governance

Key principles:

*   **Control Repo Centricity**: All behavior drives from this repo.
*   **Provider-Native First**: Don't re-invent the wheel (use Actions, Issues, Packages).
*   **Platform as Code**: Terraform is the standard for infra; Actions for orchestration.
*   **Local Reproducibility**: CLI tools must support local dry-runs (`gw:plan`).
*   **Observability**: DORA metrics via Prometheus/OpenTelemetry standards.

## 🧩 Core Concepts

### Control Repository
The heart of GitWeave. It holds:
*   **Terraform**: Modules for provisioning GitHub resources and cloud infra.
*   **Workflows**: GitHub Actions to apply configuration.
*   **Overlay Config**: Tracks which templates apply to which managed repos.

### Template Modules
Composable building blocks stored in `modules/` (e.g., `modules/lang-node`, `modules/workflows/ci-basic`).
*   **DRY**: Reused across many repos.
*   **Composable**: Mix-and-match (e.g., Node.js Starter + AWS Infra + DORA Metrics).
*   **In-Repo**: No need for separate template repositories.

### Managed Repositories
The application or library repos that GitWeave manages.
*   **Overlay Config**: Each repo has an entry in `config/repos/` defining its applied modules and environments.
*   **No Lock-in**: GitWeave manages config/workflows; the code remains standard Git.

### Metrics Aggregator
A lightweight component (Service or Workflow) that:
*   Ingests GitHub events (commits, deployments).
*   Computes DORA metrics (Lead Time, Deployment Frequency).
*   Exposes data in Prometheus/OpenTelemetry format.

## 🔄 Usage Modes

### 1. Greenfield Org (Bootstrap)
*   Clone this control repo into a new GitHub Org.
*   Configure provider binding (GitHub App/PAT).
*   Run bootstrap workflow to create initial teams and repos.

### 2. Existing Org (Overlay)
*   Clone control repo into existing Org.
*   Register existing repos via Overlay Config.
*   Run workflows to apply policies and standard workflows safely.

## 🤖 Automation Model

*   **GitHub Actions**: The primary orchestrator for applying changes.
*   **Terraform**: The engine for stateful infrastructure (repos, teams, cloud resources).
*   **Docker (Optional)**: Only used for rich dashboards or long-running aggregators if Actions are insufficient.

## 📂 Project Structure

```text
.
├── .github/
│   └── workflows/
│       ├── gitweave-apply.yaml  # Applies config/ changes
│       └── gitweave-infra.yaml  # Applies infra/ changes
├── config/                      # Overlay Configuration (YAML)
├── infra/                       # Terraform Bootstrap (Org Baseline)
├── metrics/                     # Metrics Observer Service (Python)
├── modules/                     # Template Modules
├── scripts/                     # Helper scripts
└── README.md                    # This file
```

## 🚀 Bootstrap

To initialize a new GitWeave Control Repository:

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/YOUR_ORG/gitweave-control.git
    cd gitweave-control
    ```

2.  **Run Bootstrap Script**
    This script initializes the local environment and checks prerequisites.
    ```bash
    ./scripts/bootstrap.sh
    ```

3.  **Initialize Infrastructure**
    Navigate to `infra/` to set up the organization baseline.
    **Note**: You must configure your remote state backend (S3, GCS, etc.) in `main.tf` or `backend.tf` before running this in production. For local testing, you can skip backend configuration.
    **Auth**: Ensure `GITHUB_TOKEN` is set or you are logged in via `gh auth login` so Terraform can manage the organization.
    ```bash
    cd infra
    terraform init
    terraform apply
    ```

4.  **Push to GitHub**
    ```bash
    git add .
    git commit -m "chore: bootstrap control repo"
    git push origin main
    ```

5.  **Verify Workflows**
    Check the "Actions" tab in GitHub to ensure `gitweave-infra` and `gitweave-apply` are running correctly.
