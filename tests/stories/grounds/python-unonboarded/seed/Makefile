.PHONY: tf-validate tf-plan-demo

## tf-validate: Validate the Terraform configuration in infra/ (no credentials required)
tf-validate:
	cd infra && terraform validate

## tf-plan-demo: Dry-run terraform plan using the committed demo fixture variables
tf-plan-demo:
	cd infra && terraform plan -var-file=demo.tfvars.example
