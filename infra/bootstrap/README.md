# Optional Terraform backend bootstrap

Use the company's existing backend when available. Otherwise this example creates a storage account for remote Terraform state, a private `tfstate` container and a Blob Data Contributor role for the designated state operator.

Copy `terraform.tfvars.example` to `terraform.tfvars`, replace all placeholders, and run from the repository root:

```sh
az login
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -var-file=terraform.tfvars -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap show bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output
```

Review the plan before applying. The operator needs permissions to create the resource group/account and assign the backend role. `state_operator_object_id` is the principal's object ID, not its application/client ID. Grant each additional environment pipeline identity its own backend role using the company identity process.

This bootstrap initially stores state locally; protect it and migrate it into a separately managed company backend after the storage exists. The account has ZRS, versioning, soft deletion and `prevent_destroy`. Its lifecycle should be managed by the platform team separately from application resources. No credentials belong in the example variable file.

Use the output account name in the [service backend configuration](../terraform/README.md). Azure role assignments can take time to propagate before backend login works.
