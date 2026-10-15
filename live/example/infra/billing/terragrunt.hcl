include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/billing"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
}

# Monthly budget + cost dashboard for this env. Per-env spend is attributed
# through the `Env` cost-allocation tag, which must be activated once in the
# Billing console (takes about 24h to start populating).
inputs = {
  env                = local.env
  project            = include.root.locals.project
  aws_account_id     = local.env_vars.locals.aws_account_id
  monthly_budget_usd = 150
}
