# Copilot Context: GitWeave Development Environment

This file provides context about the development environment and available shell aliases for GitHub Copilot sessions.

## Active Shell Aliases

The following aliases are configured in `~/.bashrc` and available in all WSL terminal sessions:

### Navigation
- `gitweave` - Navigate to the GitWeave project directory

### Git & GitHub
- `gits` - Show git status (`git status`)
- `gita` - Stage all changes (`git add .`)
- `gitc` - **AI-generated commit message** - Uses GitHub Copilot to generate a concise commit message based on staged changes
- `gitp` - Push to remote (`git push`)
- `gitsync` - Pull and push in one command (`git pull && git push`)
- `gitpr` - Push and open PR creation in browser (`git push && gh pr create --web`)

### Terraform
- `tf` - Terraform shorthand
- `tfcheck` - Format, validate, and plan (`terraform fmt -recursive && terraform validate && terraform plan`)
- `tfapply` - Apply with auto-approve (`terraform apply -auto-approve`)

### Python
- `py` - Python3 shorthand
- `pyclean` - Remove Python cache directories (`__pycache__`, `.pytest_cache`)
- `pycheck` - Run tests and linting (`pytest && ruff check .`)

### AI Assistance (GitHub Copilot CLI)
- `ask` - Ask how to do something (e.g., `ask list files larger than 10mb`)
- `askai` - Start interactive Copilot session with automatic prompt execution

## Python Virtual Environment

This project uses `direnv` for automatic virtual environment activation:
- `.venv/` - Python virtual environment (auto-activated when entering directory)
- `.envrc` - Direnv configuration file (run `direnv allow` after cloning)

## AWS Configuration

The AWS CLI is configured with:
- **Profile**: default
- **Region**: ap-southeast-2
- **User**: gitweave-cli-service (IAM user, not root)
- **Credentials**: Stored in `~/.aws/credentials`

## Testing

Run tests with:
```bash
# Repository structure tests
python3 tests/test_structure.py

# Metrics service tests (requires venv)
pytest metrics/tests/ -v
```
