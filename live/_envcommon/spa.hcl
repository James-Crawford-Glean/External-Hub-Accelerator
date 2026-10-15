# Shared SPA (s3-cloudfront-spa) inputs, included by every env's app/spa stack
# via `include "envcommon"`. Env differences come from env.hcl: `spa_apps`
# decides which apps are served and which CSP allowances they need.
#
# The resource name and dependency-derived inputs (csp_auth_urls, the stream
# origin) stay in each env's child terragrunt.hcl and deep-merge over these.

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  region   = local.env_vars.locals.aws_region

  graphql_domain = "gql.${local.env}.${local.env_vars.locals.domain_root}"

  # Browser fetch targets beyond the auth baseline: the white-label GraphQL
  # endpoint (https + wss for subscriptions), Cognito Identity + STS for the
  # RUM guest role, and the RUM data plane.
  csp_connect_src_urls = [
    "https://${local.graphql_domain}",
    "wss://${local.graphql_domain}",
    "https://cognito-identity.${local.region}.amazonaws.com",
    "https://sts.${local.region}.amazonaws.com",
    "https://dataplane.rum.${local.region}.amazonaws.com",
  ]
}

inputs = {
  apps        = local.env_vars.locals.spa_apps
  default_app = local.env_vars.locals.spa_default_app

  # Subset of `apps` served as multi-page static sites rather than SPAs.
  # Optional in env.hcl; absent -> [] (every app is an SPA).
  static_apps = try(local.env_vars.locals.spa_static_apps, [])

  # AppSync is hit directly by the SPA (not fronted by CloudFront); the
  # wildcard survives endpoint-id changes.
  app_sync_domain = "*.appsync-api.${local.region}.amazonaws.com"

  csp_extra_connect_src_urls = local.csp_connect_src_urls

  # Images the SPA may load beyond its own origin. Logos are served from this
  # env's own /logos path, so nothing extra is needed by default; add your
  # tenant's Glean backend host here if you render Glean-hosted avatars.
  csp_extra_img_src_urls = []

  csp_extra_frame_src_urls = []

  # Single public hostname per env; see env.hcl.
  custom_domain   = local.env_vars.locals.spa_domain
  route53_zone_id = local.env_vars.locals.route53_zone_id
}
