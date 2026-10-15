include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/network"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  region   = local.env_vars.locals.aws_region
  project  = include.root.locals.project
}

inputs = {
  name = "${local.project}-network-${local.env}"
  env  = local.env

  # Fixed per environment but overridable so a peered or multi-account
  # topology can shift one env out of conflict.
  cidr = "10.20.0.0/16"

  # Two AZs is the Aurora minimum. NAT lives in the FIRST entry only; see
  # the module for the cost rationale.
  azs = ["${local.region}a", "${local.region}b"]
}
