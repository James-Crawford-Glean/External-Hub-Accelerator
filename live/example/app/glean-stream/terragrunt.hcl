# Glean chat streaming: a response-streaming Lambda behind a REST API,
# fronted same-origin by CloudFront at /glean-api/*. Resolves the caller's
# per-user Glean OAuth token from Aurora and proxies Glean chat as SSE.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/app/glean-stream"
}

locals {
  env_vars  = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env       = local.env_vars.locals.env
  project   = include.root.locals.project
  repo_root = dirname(find_in_parent_folders("root.hcl"))
  app       = local.env_vars.locals.spa_default_app
}

# The REST API's COGNITO_USER_POOLS authorizer validates the SPA's ID token
# against the pool ARN.
dependency "cognito" {
  config_path = "../../infra/cognito"

  mock_outputs = {
    user_pool_arn = "arn:aws:cognito-idp:us-east-2:000000000000:userpool/us-east-2_EXAMPLE"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "aurora" {
  config_path = "../../infra/aurora"

  mock_outputs = {
    cluster_arn               = "arn:aws:rds:us-east-2:000000000000:cluster:mock"
    master_password_secret_id = "arn:aws:secretsmanager:us-east-2:000000000000:secret:rds-mock"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  name       = "${local.project}-glean-stream-${local.env}"
  source_dir = "${local.repo_root}/backend/dist/stream"

  user_pool_arn = dependency.cognito.outputs.user_pool_arn

  aurora_cluster_arn = dependency.aurora.outputs.cluster_arn
  aurora_secret_arn  = dependency.aurora.outputs.master_password_secret_id
  aurora_database    = local.project

  # Glean per-user OAuth (public PKCE client registered through DCR; no
  # client secret). GLEAN_BASE_URL is your tenant's backend origin,
  # https://<tenant>-be.glean.com. Redirect URIs must match the SPA callback.
  env_vars = {
    GLEAN_BASE_URL      = get_env("GLEAN_BASE_URL")
    GLEAN_SCOPES        = "openid email offline_access search chat entities"
    GLEAN_REDIRECT_URIS = "http://localhost:5173/glean/callback,https://${local.env_vars.locals.spa_domain}/${local.app}/glean/callback"
    GLEAN_CLIENT_NAME   = local.project
  }
}
