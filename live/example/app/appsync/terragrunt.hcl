# GraphQL API: AppSync in front of the Node dispatcher Lambda, resolvers wired
# from backend/schema.graphql. Ordered after aurora-migrate so a code deploy
# can never outrun the schema it reads.

include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/app/appsync"
}

locals {
  env_vars  = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env       = local.env_vars.locals.env
  project   = include.root.locals.project
  repo_root = dirname(find_in_parent_folders("root.hcl"))
  app       = local.env_vars.locals.spa_default_app
}

# Unified Lambda authorizer (Cognito ID tokens + opaque API keys): AppSync's
# primary auth mode. The resolved principal arrives in resolverContext.
dependency "authorizer" {
  config_path = "../../app/authorizer"

  mock_outputs = {
    function_arn  = "arn:aws:lambda:us-east-2:000000000000:function:mock-authorizer"
    function_name = "mock-authorizer"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

dependency "dynamodb" {
  config_path = "../../infra/dynamodb"

  mock_outputs = {
    table_arns  = {}
    name_prefix = "${local.project}-${local.env}"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

# Logos and avatars are written into the SPA bucket under logos/ and avatars/
# and served by the SPA distribution; no second bucket or origin.
dependency "spa" {
  config_path = "../../app/spa"

  mock_outputs = {
    bucket     = "${local.project}-spa-${local.env}"
    bucket_arn = "arn:aws:s3:::${local.project}-spa-${local.env}"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

# Ordering edge only: no outputs consumed.
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

# Example domain: the admin "re-index now" action invokes the glean-index worker.
dependency "glean_index" {
  config_path = "../../data-pipeline/glean-index"

  mock_outputs = {
    function_name = "mock-glean-index"
    function_arn  = "arn:aws:lambda:us-east-2:000000000000:function:mock-glean-index"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "init", "plan"]
}

inputs = {
  name        = "${local.project}-graphql-${local.env}"
  schema_path = "${local.repo_root}/backend/schema.graphql"
  source_dir  = "${local.repo_root}/backend/dist/api"

  graphql_domain  = "gql.${local.env}.${local.env_vars.locals.domain_root}"
  route53_zone_id = local.env_vars.locals.route53_zone_id

  authorizer_function_arn  = dependency.authorizer.outputs.function_arn
  authorizer_function_name = dependency.authorizer.outputs.function_name

  api_key_pepper_secret_name = "${local.project}-${local.env}/api-key-pepper"

  ddb_table_arns   = dependency.dynamodb.outputs.table_arns
  ddb_table_prefix = dependency.dynamodb.outputs.name_prefix

  logo_bucket_arn     = dependency.spa.outputs.bucket_arn
  logo_bucket_name    = dependency.spa.outputs.bucket
  logo_cdn_url_prefix = "https://${local.env_vars.locals.spa_domain}"

  aurora_cluster_arn = dependency.aurora.outputs.cluster_arn
  aurora_secret_arn  = dependency.aurora.outputs.master_password_secret_id
  aurora_database    = local.project

  # Async CSV exports are opt-in: point exports_worker_dir at a built worker
  # bundle (backend/dist/workers/export-csv) once your domain has one.
  exports_worker_dir = ""

  invoke_function_arns = [dependency.glean_index.outputs.function_arn]

  # Glean per-user OAuth (public PKCE client via DCR; no client secret).
  # Redirect URIs must match the SPA's callback route.
  env_vars = {
    GLEAN_BASE_URL       = get_env("GLEAN_BASE_URL")
    GLEAN_SCOPES         = "openid email offline_access search chat entities"
    GLEAN_REDIRECT_URIS  = "http://localhost:5173/glean/callback,https://${local.env_vars.locals.spa_domain}/${local.app}/glean/callback"
    PORTAL_APP_URL       = "https://${local.env_vars.locals.spa_domain}/${local.app}"
    PORTAL_NAME          = title(local.project)
    GLEAN_CLIENT_NAME    = local.project
    GLEAN_INDEX_FUNCTION = dependency.glean_index.outputs.function_name

    # Must match the observability stack's perf_metrics_namespace.
    PERF_METRICS_NAMESPACE = "${title(local.project)}/Perf"
    APP_ENV                = local.env
  }
}
