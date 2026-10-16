# CloudWatch dashboards for this env: an overview of every stack and a
# performance view over the backend's EMF metrics. View-only; add alarms in a
# separate stack when the env carries production traffic.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/observability"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  region   = local.env_vars.locals.aws_region
  project  = include.root.locals.project

  # Every Lambda the env deploys, by the names the app stacks assign. Add a
  # line when you add a stack.
  lambda_function_names = [
    "${local.project}-graphql-${local.env}",
    "${local.project}-authorizer-${local.env}",
    "${local.project}-mcp-${local.env}",
    "${local.project}-glean-stream-${local.env}",
    "${local.project}-warmer-${local.env}",
    "${local.project}-aurora-migrate-${local.env}",
    "${local.project}-item-sync-${local.env}",
    "${local.project}-glean-index-${local.env}",
  ]
  # Scheduled jobs whose failures should surface as a daily error count.
  scheduled_function_names = [
    "${local.project}-warmer-${local.env}",
    "${local.project}-item-sync-${local.env}",
    "${local.project}-glean-index-${local.env}",
  ]
}

dependency "appsync" {
  config_path                             = "../../app/appsync"
  mock_outputs                            = { api_id = "mock-appsync-id" }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "cognito" {
  config_path                             = "../../infra/cognito"
  mock_outputs                            = { user_pool_id = "us-east-2_MOCK" }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "spa" {
  config_path                             = "../../app/spa"
  mock_outputs                            = { distribution_id = "EMOCK", bucket = "mock-spa-bucket" }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "dynamodb" {
  config_path                             = "../../infra/dynamodb"
  mock_outputs                            = { table_names = { mock = "mock-table" } }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  project = local.project
  env     = local.env
  region  = local.region

  appsync_api_id             = dependency.appsync.outputs.api_id
  cognito_user_pool_id       = dependency.cognito.outputs.user_pool_id
  cloudfront_distribution_id = dependency.spa.outputs.distribution_id
  spa_bucket_name            = dependency.spa.outputs.bucket
  dynamodb_table_names       = values(dependency.dynamodb.outputs.table_names)

  aurora_cluster_identifier = "${local.project}-aurora-${local.env}"
  lambda_function_names     = local.lambda_function_names
  scheduled_function_names  = local.scheduled_function_names

  # Must match the namespace the backend's metrics lib emits into.
  perf_metrics_namespace = "${title(local.project)}/Perf"
  rum_app_monitor_name   = "${local.project}-rum-${local.env}"
}
