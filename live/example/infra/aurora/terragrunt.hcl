# Aurora Serverless v2 (PostgreSQL) cluster for this environment.
#
# Apply order: infra/network first (VPC + DB subnet group), then this stack.
#
# The master password is generated and managed by RDS itself
# (`manage_master_user_password = true` in the module). RDS creates a
# Secrets Manager secret at cluster-create time and rotates it; no human
# `put-secret-value` step is required and CI keeps zero secret-read perms.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/aurora-postgres"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  project  = include.root.locals.project
}

dependency "network" {
  config_path = "../../infra/network"

  mock_outputs = {
    vpc_id               = "vpc-mock"
    db_subnet_group_name = "${local.project}-network-${local.env}"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "init"]
}

inputs = {
  name          = "${local.project}-aurora-${local.env}"
  env           = local.env
  database_name = local.project

  vpc_id               = dependency.network.outputs.vpc_id
  db_subnet_group_name = dependency.network.outputs.db_subnet_group_name

  # Lambdas reach the cluster over the RDS Data API, not the VPC, so no
  # security group needs ingress. Add one here only for a VPC-attached client.
  app_security_group_ids = []
}
