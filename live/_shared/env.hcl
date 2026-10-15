# Account-scoped values for stacks that aren't tied to one environment
# (currently github-oidc, which manages a single CI deploy role per AWS
# account regardless of how many envs share the account).
#
# `env = "_shared"` is a marker: resources owned by this directory carry
# Env=_shared so they're distinguishable from per-env resources at a glance.
locals {
  env            = "_shared"
  aws_region     = get_env("AWS_REGION", "us-east-2")
  aws_account_id = get_env("AWS_ACCOUNT")
}
