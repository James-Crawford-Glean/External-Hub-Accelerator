include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/cognito"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  project  = include.root.locals.project

  # One OAuth redirect target per deployed SPA (apps/<name>/ is served at
  # /<name>/), plus the Vite dev and preview servers for local work.
  app_urls = concat(
    ["http://localhost:5173/", "http://localhost:4173/"],
    [for app in local.env_vars.locals.spa_apps : "https://${local.env_vars.locals.spa_domain}/${app}/"],
  )
}

inputs = {
  name          = "${local.project}-${local.env}"
  domain_prefix = "${local.project}-${local.env}"

  callback_urls = local.app_urls
  logout_urls   = local.app_urls

  # Authoritative domain gate (pre-sign-up trigger).
  allowed_email_domains = local.env_vars.locals.allowed_email_domains

  # White-label hosted UI at auth.<env>.<domain_root> (cert in us-east-1,
  # alias in this env's zone). Prereq: the SPA stack is deployed so the parent
  # hostname has an A record. After first apply, add
  # https://auth.<env>.<domain_root>/oauth2/idpresponse to the Google client's
  # Authorized redirect URIs (alongside the prefix-domain idpresponse).
  custom_auth_domain = "auth.${local.env}.${local.env_vars.locals.domain_root}"
  route53_zone_id    = local.env_vars.locals.route53_zone_id

  # Google OAuth client credentials, populated out-of-band (see README).
  # Cognito reads {client_id, client_secret} from the `web` sub-key.
  google_secret_name = "${local.project}-${local.env}/oidc/google"
}
