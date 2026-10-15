# Scheduled warm/cool for the Serverless v2 cluster: raise min ACU to 0.5 at
# the start of the working day and drop it back to 0 (auto-pause) at close of
# business, weekdays only. Pure cost control; the aurora stack's own baseline
# stays warm, so a stray aurora apply can only leave the cluster warm, never
# cold. Optional: skip this stack if the cluster should stay warm around the
# clock.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/aurora-schedule"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  project  = include.root.locals.project
}

dependency "aurora" {
  config_path = "../aurora"

  mock_outputs = {
    cluster_arn = "arn:aws:rds:us-east-2:000000000000:cluster:mock"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "init"]
}

inputs = {
  name               = "${local.project}-aurora-${local.env}"
  cluster_identifier = "${local.project}-aurora-${local.env}"
  cluster_arn        = dependency.aurora.outputs.cluster_arn
  # Must match the aurora module's max_capacity (module default 1.0).
  max_capacity = 1.0
  # Warm/cool times and timezones use the module defaults; override there.
}
