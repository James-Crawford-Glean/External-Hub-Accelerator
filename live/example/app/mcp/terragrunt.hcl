# MCP server on its own hostname (mcp.<env>.<domain_root>), the path through
# which Glean chat reads and writes portal data at query time. OAuth 2.1 is
# the primary auth; the unified authorizer additionally admits opaque API keys
# for service accounts.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/app/mcp"
}

locals {
  env_vars  = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env       = local.env_vars.locals.env
  project   = include.root.locals.project
  repo_root = dirname(find_in_parent_folders("root.hcl"))
  mcp_host  = "mcp.${local.env}.${local.env_vars.locals.domain_root}"
}

dependency "authorizer" {
  config_path = "../authorizer"

  mock_outputs = {
    invoke_arn    = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:000000000000:function:mock-authorizer/invocations"
    function_name = "mock-authorizer"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

# Ordering edge only: tools read tables the migrations create.
dependency "aurora_migrate" {
  config_path = "../../data-pipeline/aurora-migrate"

  mock_outputs = {
    function_name = "mock-migrate"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "aurora" {
  config_path = "../../infra/aurora"

  mock_outputs = {
    cluster_arn               = "arn:aws:rds:us-east-2:000000000000:cluster:mock"
    master_password_secret_id = "arn:aws:secretsmanager:us-east-2:000000000000:secret:rds-mock"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

# OAuth resource server: AS/PRM metadata + DCR over this pool, access tokens
# verified against its JWKS. The resource identifier is the pool's `mcp`
# resource server, which is also this stack's public hostname.
dependency "cognito" {
  config_path = "../../infra/cognito"

  mock_outputs = {
    issuer_url              = "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_EXAMPLE"
    hosted_ui_url           = "https://auth.example.portal.example.com"
    user_pool_id            = "us-east-2_EXAMPLE"
    user_pool_arn           = "arn:aws:cognito-idp:us-east-2:000000000000:userpool/us-east-2_EXAMPLE"
    app_client_id           = "example-client-id"
    mcp_resource_identifier = "https://mcp.example.portal.example.com"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  name       = "${local.project}-mcp-${local.env}"
  source_dir = "${local.repo_root}/backend/dist/mcp"

  custom_domain   = local.mcp_host
  route53_zone_id = local.env_vars.locals.route53_zone_id

  portal_name           = title(local.project)
  allowed_email_domains = local.env_vars.locals.allowed_email_domains

  oauth = {
    public_url          = "https://${local.mcp_host}"
    issuer              = dependency.cognito.outputs.issuer_url
    hosted_ui_url       = dependency.cognito.outputs.hosted_ui_url
    user_pool_id        = dependency.cognito.outputs.user_pool_id
    user_pool_arn       = dependency.cognito.outputs.user_pool_arn
    resource_identifier = dependency.cognito.outputs.mcp_resource_identifier
    spa_client_id       = dependency.cognito.outputs.app_client_id
    # Hosts a DCR client may register https redirect URIs on (exact or *.suffix).
    # For Glean, your tenant's backend host. Comma-separated in the environment.
    redirect_hosts = compact(split(",", get_env("MCP_REDIRECT_HOSTS", "")))
  }

  authorizer_invoke_arn    = dependency.authorizer.outputs.invoke_arn
  authorizer_function_name = dependency.authorizer.outputs.function_name

  aurora_cluster_arn = dependency.aurora.outputs.cluster_arn
  aurora_secret_arn  = dependency.aurora.outputs.master_password_secret_id
  aurora_database    = local.project

  # Writes require an acting user; with no identity on the connection the
  # tools report that an email is required rather than fall back to a shared
  # identity that would mis-attribute every write.
  env_vars = {
    LOGO_CDN_ORIGIN        = "https://${local.env_vars.locals.spa_domain}"
    PORTAL_APP_URL         = "https://${local.env_vars.locals.spa_domain}/${local.env_vars.locals.spa_default_app}"
    PERF_METRICS_NAMESPACE = "${title(local.project)}/Perf"
    APP_ENV                = local.env
  }
}
