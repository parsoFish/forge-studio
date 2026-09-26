# Infrastructure Bootstrap

This directory contains instructions for the initial bootstrap of the GitWeave infrastructure.

## State Management

GitWeave does not prescribe a specific remote state backend. You are expected to configure the backend that best fits your organization's needs (e.g., S3, GCS, Azure Blob Storage, Terraform Cloud).

### Configuration Steps

1.  Create a `backend.tf` file in `infra/` (or add to `main.tf`).
2.  Configure your backend block:
    ```hcl
    terraform {
      backend "s3" {
        bucket = "my-org-terraform-state"
        key    = "gitweave/control.tfstate"
        region = "us-east-1"
      }
    }
    ```
3.  Run `terraform init`.

## Local Testing

For development and testing, you can omit the backend configuration to use local state (`terraform.tfstate`). Ensure you add `*.tfstate` to your `.gitignore` (already done by default).
