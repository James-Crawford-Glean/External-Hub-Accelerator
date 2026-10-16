# Example domain: hourly pull of items from the upstream system. Without
# UPSTREAM_URL the worker loads its built-in fixture, so a fresh environment
# has data to look at; invoke_on_apply populates it before the first schedule.
# Ordered after aurora-migrate so the example schema exists.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/data-pipeline/scheduled-worker"
}

locals {
  env_vars  = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env       = local.env_vars.locals.env
  project   = include.root.locals.project
  repo_root = dirname(find_in_parent_folders("root.hcl"))
}

dependency "aurora" {
  config_path = "../../infra/aurora"
  mock_outputs = {
    cluster_arn               = "arn:aws:rds:us-east-2:000000000000:cluster:mock"
    master_password_secret_id = "arn:aws:secretsmanager:us-east-2:000000000000:secret:rds-mock"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "aurora_migrate" {
  config_path                             = "../aurora-migrate"
  mock_outputs                            = { function_name = "mock-migrate" }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  name       = "${local.project}-item-sync-${local.env}"
  source_dir = "${local.repo_root}/backend/dist/workers/item-sync"

  aurora_cluster_arn = dependency.aurora.outputs.cluster_arn
  aurora_secret_arn  = dependency.aurora.outputs.master_password_secret_id
  aurora_database    = local.project

  schedule_expression = "rate(1 hour)"
  invoke_on_apply     = true

  env_vars = {
    UPSTREAM_URL           = get_env("UPSTREAM_URL", "")
    PERF_METRICS_NAMESPACE = "${title(local.project)}/Perf"
    APP_ENV                = local.env
  }
}
