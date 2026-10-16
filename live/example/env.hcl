# Environment coordinates for `example`. Copy this directory to live/<env>/
# and change `env` to add an environment; every other value is read from the
# environment variables listed in .env.example so no account id, zone id, or
# hostname is committed.
locals {
  env            = "example"
  aws_region     = get_env("AWS_REGION", "us-east-2")
  aws_account_id = get_env("AWS_ACCOUNT")

  # Email-domain allowlist. Enforced by the Cognito pre-sign-up trigger
  # (live/<env>/infra/cognito): a federated identity outside this list is
  # rejected before a user is created. Comma-separated.
  allowed_email_domains = split(",", get_env("ALLOWED_EMAIL_DOMAINS"))

  # Parent DNS zone. The env is served at <env>.<domain_root> unless
  # spa_domain_override names a different hostname in the same zone.
  domain_root     = get_env("PORTAL_DOMAIN_ROOT")
  route53_zone_id = get_env("ROUTE53_ZONE_ID")

  # Single public hostname per environment. CloudFront fronts the static SPA
  # assets; data access goes directly to AppSync and the MCP/stream APIs under
  # their own white-label hostnames in the same zone. One origin keeps cookie
  # scoping tight and the edge as the sole perimeter.
  spa_domain_override = ""
  spa_domain          = local.spa_domain_override != "" ? local.spa_domain_override : "${local.env}.${local.domain_root}"

  # SPA surfaces deployed in this env (apps/<name>/). The first entry that is
  # also `spa_default_app` is served at the root redirect. Each entry also
  # becomes a Cognito callback / logout URL (https://<spa_domain>/<app>/).
  spa_apps        = ["portal", "dev"]
  spa_default_app = "portal"

  # Apps in `spa_apps` served as multi-page static sites (the Docusaurus
  # developer portal) rather than single-page apps. The edge resolves per-route
  # objects for these instead of falling back to the SPA index.html; without
  # this a deep link under /dev/ is a 404 at the edge.
  spa_static_apps = ["dev"]
}
