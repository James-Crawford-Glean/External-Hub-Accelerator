# CloudWatch RUM app monitor + Cognito guest identity pool for the SPA.
# Self-contained (no stack dependencies). Its outputs (app_monitor_id,
# identity_pool_id, guest_role_arn, region) are read by the SPA deploy
# workflow and injected as VITE_RUM_* at build time. Optional: skip this
# stack to run without browser telemetry.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/app/rum"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  project  = include.root.locals.project
}

inputs = {
  name    = "${local.project}-rum-${local.env}"
  domains = [local.env_vars.locals.spa_domain]
}
