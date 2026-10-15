include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../modules/infra/github-oidc"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  project  = include.root.locals.project
  account  = local.env_vars.locals.aws_account_id
  region   = local.env_vars.locals.aws_region

  state_bucket_arn = "arn:aws:s3:::${local.project}-tf-state-${local.account}"
  lock_table_arn   = "arn:aws:dynamodb:${local.region}:${local.account}:table/${local.project}-tf-locks"

  # One GitHub Environment per deployable env. Add an entry here when you add
  # a live/<env>/ directory, then create the matching Environment in the repo
  # (Settings -> Environments) and restrict its deployment branches to main.
  deploy_envs = ["example"]
}

inputs = {
  # github_org and github_repo are merged in from root.hcl.
  state_bucket_arn = local.state_bucket_arn
  lock_table_arn   = local.lock_table_arn

  # Trust pins on the GitHub Environment claim. The workflow job declares
  # `environment: ${{ inputs.env }}`, so the OIDC token's sub becomes
  # repo:<org>/<repo>:environment:<env>.
  trust_subject_patterns = [
    for env in local.deploy_envs :
    "repo:${include.root.locals.github_org}/${include.root.locals.github_repo}:environment:${env}"
  ]

  # CI may read this one secret value at apply time: the Cognito stack passes
  # the Google OAuth client credentials into the identity provider resource.
  # Every other secret is read at runtime by a Lambda, never by Terraform.
  allowed_secret_value_read_arns = [
    "arn:aws:secretsmanager:${local.region}:${local.account}:secret:${local.project}-*/oidc/google-*",
  ]
}
