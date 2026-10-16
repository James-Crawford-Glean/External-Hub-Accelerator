# Hub -> Glean: pushes items into a custom Glean datasource through the
# Indexing API. Incremental every 15 minutes; a full re-index (which also
# registers the datasource) runs from the admin screen via triggerGleanIndex.
# Needs the <project>-<env>/glean-indexing-token secret populated with a
# datasource-scoped indexing token from the Glean admin console.

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
  app       = local.env_vars.locals.spa_default_app
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
  name       = "${local.project}-glean-index-${local.env}"
  source_dir = "${local.repo_root}/backend/dist/workers/glean-index"

  aurora_cluster_arn = dependency.aurora.outputs.cluster_arn
  aurora_secret_arn  = dependency.aurora.outputs.master_password_secret_id
  aurora_database    = local.project

  secret_names = ["${local.project}-${local.env}/glean-indexing-token"]
  secret_env   = { GLEAN_INDEXING_TOKEN_SECRET = "${local.project}-${local.env}/glean-indexing-token" }

  schedule_expression = "rate(15 minutes)"

  env_vars = {
    GLEAN_BASE_URL         = get_env("GLEAN_BASE_URL")
    GLEAN_DATASOURCE       = "${replace(local.project, "-", "_")}_items"
    PORTAL_NAME            = title(local.project)
    PORTAL_APP_URL         = "https://${local.env_vars.locals.spa_domain}/${local.app}"
    PERF_METRICS_NAMESPACE = "${title(local.project)}/Perf"
    APP_ENV                = local.env
  }
}
