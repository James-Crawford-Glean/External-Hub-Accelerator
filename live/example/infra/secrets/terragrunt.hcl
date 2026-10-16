include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/secrets-store"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  project  = include.root.locals.project
}

inputs = {
  name    = "${local.project}-secrets-${local.env}"
  env     = local.env
  project = local.project

  # Slot names. Each becomes an empty secret at `<project>-<env>/<name>`.
  # Populate values from an operator's credentials with
  # `aws secretsmanager put-secret-value`; CI can declare slots but never
  # read or write their values.
  #
  # Not declared here:
  #   - Aurora's master credentials: RDS owns that secret
  #     (`manage_master_user_password = true`).
  #   - `<project>-<env>/oidc/google`: created out-of-band before the Cognito
  #     stack's first apply and referenced by name from there.
  secret_names = [
    "api-key-pepper",       # HMAC pepper the authorizer uses to hash opaque API keys
    "glean-indexing-token", # datasource-scoped Indexing API token for the glean-index worker
  ]
}
