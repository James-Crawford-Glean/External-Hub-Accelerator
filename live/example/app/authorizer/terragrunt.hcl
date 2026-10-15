include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/app/authorizer"
}

locals {
  env_vars  = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env       = local.env_vars.locals.env
  project   = include.root.locals.project
  repo_root = dirname(find_in_parent_folders("root.hcl"))
}

# Cognito issuer + SPA client id: the JWT path validates ID tokens with the
# audience pinned to the SPA client.
dependency "cognito" {
  config_path = "../../infra/cognito"
  mock_outputs = {
    issuer_url    = "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_EXAMPLE"
    app_client_id = "example-client-id"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

# api_keys table (prefix + ARN for the key-lookup grant).
dependency "dynamodb" {
  config_path = "../../infra/dynamodb"
  mock_outputs = {
    name_prefix = "${local.project}-${local.env}"
    table_arns  = { api_keys = "arn:aws:dynamodb:us-east-2:000000000000:table/${local.project}-${local.env}-api_keys" }
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  name       = "${local.project}-authorizer-${local.env}"
  source_dir = "${local.repo_root}/backend/dist/authorizer"

  cognito_issuer    = dependency.cognito.outputs.issuer_url
  cognito_client_id = dependency.cognito.outputs.app_client_id

  ddb_table_prefix   = dependency.dynamodb.outputs.name_prefix
  api_keys_table_arn = dependency.dynamodb.outputs.table_arns["api_keys"]

  # Declared by infra/secrets; populated out-of-band before first apply.
  pepper_secret_name = "${local.project}-${local.env}/api-key-pepper"
}
