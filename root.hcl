# Root Terragrunt config. Every stack under live/ includes this file.
#
# Edit the three literals in `locals` once, before the first apply:
#   project      prefixes every resource name and the state key. Changing it
#                later means a new set of resources, not a rename.
#   github_org   GitHub coordinates the OIDC deploy role trusts.
#   github_repo
#
# Per-environment values (account id, region, domain, zone) come from
# live/<env>/env.hcl, which reads them from environment variables. See
# .env.example at the repo root.
#
# State backend: one S3 bucket per AWS account, created by bootstrap/.
#   bucket: <project>-tf-state-<account>
# Locking uses Terraform's S3-native lockfile; a `.tflock` object lives next
# to each state file in the same bucket.

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))

  project     = "portal"
  github_org  = "your-github-org"
  github_repo = "your-portal-repo"

  aws_region     = local.env_vars.locals.aws_region
  aws_account_id = local.env_vars.locals.aws_account_id
  env            = local.env_vars.locals.env

  # Which env's VPC this env uses. Defaults to the env itself. A lightweight
  # env (a feature sandbox, a per-developer env) can set vpc_env in its env.hcl
  # to share another env's network instead of paying for its own.
  vpc_env = try(local.env_vars.locals.vpc_env, local.env)

  state_bucket = "${local.project}-tf-state-${local.aws_account_id}"

  # State key ignores the grouping folder (data-pipeline / infra / app), so
  # moving a stack between groups never moves its state. e.g.
  # live/example/infra/network keeps key <project>/live/example/network/...
  # Patterns are deliberately NOT slash-wrapped: Terraform's replace() treats
  # a /.../ second arg as a regex, so "<group>/" is a literal strip.
  state_path = replace(replace(replace(
  path_relative_to_include(), "data-pipeline/", ""), "infra/", ""), "app/", "")
}

remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket       = local.state_bucket
    key          = "${local.project}/${local.state_path}/terraform.tfstate"
    region       = local.aws_region
    encrypt      = true
    use_lockfile = true
  }
}

generate "providers" {
  path      = "providers.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<TF
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region              = "${local.aws_region}"
  allowed_account_ids = ["${local.aws_account_id}"]
  default_tags {
    tags = merge({
      Project   = "${local.project}"
      Env       = "${local.env}"
      ManagedBy = "terragrunt"
      }, "${local.vpc_env}" != "${local.env}" ? {
      VpcEnv = "${local.vpc_env}"
    } : {})
  }
}

# us-east-1 alias: CloudFront and Cognito custom-domain ACM certs must live there.
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = ["${local.aws_account_id}"]
  default_tags {
    tags = merge({
      Project   = "${local.project}"
      Env       = "${local.env}"
      ManagedBy = "terragrunt"
      }, "${local.vpc_env}" != "${local.env}" ? {
      VpcEnv = "${local.vpc_env}"
    } : {})
  }
}
TF
}

inputs = merge(
  local.env_vars.locals,
  {
    project     = local.project
    github_org  = local.github_org
    github_repo = local.github_repo
  }
)
