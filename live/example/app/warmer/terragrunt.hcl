# Keep-alive for the user-facing Lambdas. Each run also touches Aurora, which
# wakes a paused Serverless v2 cluster; the schedule below is a trade-off
# between cold starts and auto-pause savings.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/app/lambda-warmer"
}

locals {
  env_vars  = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env       = local.env_vars.locals.env
  region    = local.env_vars.locals.aws_region
  account   = local.env_vars.locals.aws_account_id
  project   = include.root.locals.project
  repo_root = dirname(find_in_parent_folders("root.hcl"))

  # The GraphQL dispatcher's ARN is convention-derived so this stack doesn't
  # need to depend on app/appsync.
  graphql_fn_arn = "arn:aws:lambda:${local.region}:${local.account}:function:${local.project}-graphql-${local.env}"
}

dependency "glean_stream" {
  config_path                             = "../../app/glean-stream"
  mock_outputs                            = { function_arn = "arn:aws:lambda:us-east-2:000000000000:function:mock-stream" }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "aurora" {
  config_path                             = "../../infra/aurora"
  mock_outputs                            = { cluster_arn = "arn:aws:rds:us-east-2:000000000000:cluster:mock", master_password_secret_id = "arn:aws:secretsmanager:us-east-2:000000000000:secret:mock" }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  name       = "${local.project}-warmer-${local.env}"
  source_dir = "${local.repo_root}/backend/dist/workers/warmer"

  # Non-production default: warm once a day so auto-pause still pays off.
  # A production env would use rate(5 minutes) and keep the cluster warm.
  schedule_expression = "rate(1 day)"

  target_function_arns = [local.graphql_fn_arn, dependency.glean_stream.outputs.function_arn]

  aurora_cluster_arn = dependency.aurora.outputs.cluster_arn
  aurora_secret_arn  = dependency.aurora.outputs.master_password_secret_id
  aurora_database    = local.project
}
