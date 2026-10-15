include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

# Shared SPA inputs (apps, CSP allowances) derive from env.hcl's spa_apps.
# Only the dependency-wired inputs below are env-local.
include "envcommon" {
  path           = "${dirname(find_in_parent_folders("root.hcl"))}/live/_envcommon/spa.hcl"
  merge_strategy = "deep"
}

terraform {
  source = "../../../../modules/app/s3-cloudfront-spa"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  project  = include.root.locals.project
  env      = local.env_vars.locals.env
}

# Cognito issuer + hosted-UI origins for the SPA's CSP (OIDC metadata/token
# fetch + silent renew).
dependency "cognito" {
  config_path = "../../infra/cognito"

  mock_outputs = {
    issuer_url    = "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_EXAMPLE"
    hosted_ui_url = "https://${local.project}-${local.env}.auth.us-east-2.amazoncognito.com"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

# Glean chat streaming API, fronted same-origin at /glean-api/*. domain feeds
# the CloudFront origin; stage feeds the origin_path.
dependency "glean_stream" {
  config_path = "../../app/glean-stream"

  mock_outputs = {
    api_origin_domain = "glean-mock.execute-api.us-east-2.amazonaws.com"
    stage             = "live"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  name = "${local.project}-spa-${local.env}"

  api_origin_domain = ""
  csp_auth_urls = [
    "https://cognito-idp.${local.env_vars.locals.aws_region}.amazonaws.com",
    dependency.cognito.outputs.hosted_ui_url,
  ]

  glean_stream_origin_domain = dependency.glean_stream.outputs.api_origin_domain
  glean_stream_origin_path   = "/${dependency.glean_stream.outputs.stage}"
}
