# Cognito user pool fronting Google. The SPA is a public PKCE client; the
# pool federates Google (creds from Secrets Manager) and issues RS256 JWTs
# that AppSync + the HTTP API verify against this pool's JWKS. No shared
# secret leaves Cognito; nothing self-mints tokens.

data "aws_region" "current" {}

locals {
  domain_prefix = var.domain_prefix != "" ? var.domain_prefix : var.name
  google        = jsondecode(data.aws_secretsmanager_secret_version.google.secret_string)[var.google_secret_json_key]
  issuer        = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  # Browser-facing hosted-UI host: the white-label domain when set, else the
  # Cognito prefix domain. The token issuer is unaffected either way.
  active_hosted_domain = var.custom_auth_domain != "" ? var.custom_auth_domain : "${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

# Google OAuth creds — manually populated outside TF (same slot the old
# perimeter used). Read at apply time only to configure the IdP; the secret
# stays in Secrets Manager and never reaches the SPA or the edge.
data "aws_secretsmanager_secret" "google" {
  name = var.google_secret_name
}

data "aws_secretsmanager_secret_version" "google" {
  secret_id = data.aws_secretsmanager_secret.google.id
}

# --------------------------------------------------------------------------
# Pre-sign-up trigger: domain allowlist + auto-confirm federated users.
# --------------------------------------------------------------------------
data "archive_file" "presignup" {
  type        = "zip"
  source_file = "${path.module}/triggers/presignup.py"
  output_path = "${path.module}/.build/${var.name}-presignup.zip"
}

data "aws_iam_policy_document" "trigger_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "trigger" {
  name               = "${var.name}-cognito-presignup"
  assume_role_policy = data.aws_iam_policy_document.trigger_trust.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "trigger_basic" {
  role       = aws_iam_role.trigger.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "presignup" {
  name              = "/aws/lambda/${var.name}-presignup"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_lambda_function" "presignup" {
  function_name    = "${var.name}-presignup"
  role             = aws_iam_role.trigger.arn
  handler          = "presignup.handler"
  runtime          = var.runtime
  filename         = data.archive_file.presignup.output_path
  source_code_hash = data.archive_file.presignup.output_base64sha256
  memory_size      = 128
  timeout          = 5

  environment {
    variables = {
      ALLOWED_EMAIL_DOMAINS = join(",", var.allowed_email_domains)
    }
  }

  depends_on = [aws_cloudwatch_log_group.presignup]
  tags       = var.tags
}

resource "aws_lambda_permission" "cognito_invoke_presignup" {
  statement_id  = "AllowCognitoInvokePreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presignup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

# --------------------------------------------------------------------------
# Pre-token-generation trigger (V2): puts `email` on access tokens so the MCP
# resource server can resolve roster roles from the bearer token alone. Fires
# for every client in the pool; the extra claim is inert for the SPA. Only
# created alongside the MCP resources. Shares the presignup execution role.
# --------------------------------------------------------------------------
data "archive_file" "pretoken" {
  count       = var.mcp == null ? 0 : 1
  type        = "zip"
  source_file = "${path.module}/triggers/pretoken.py"
  output_path = "${path.module}/.build/${var.name}-pretoken.zip"
}

resource "aws_cloudwatch_log_group" "pretoken" {
  count             = var.mcp == null ? 0 : 1
  name              = "/aws/lambda/${var.name}-pretoken"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_lambda_function" "pretoken" {
  count            = var.mcp == null ? 0 : 1
  function_name    = "${var.name}-pretoken"
  role             = aws_iam_role.trigger.arn
  handler          = "pretoken.handler"
  runtime          = var.runtime
  filename         = data.archive_file.pretoken[0].output_path
  source_code_hash = data.archive_file.pretoken[0].output_base64sha256
  memory_size      = 128
  timeout          = 5

  depends_on = [aws_cloudwatch_log_group.pretoken]
  tags       = var.tags
}

resource "aws_lambda_permission" "cognito_invoke_pretoken" {
  count         = var.mcp == null ? 0 : 1
  statement_id  = "AllowCognitoInvokePreTokenGeneration"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pretoken[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

# --------------------------------------------------------------------------
# User pool. Federated-only (no self-service password sign-up exposed); the
# pre-sign-up trigger is the authoritative domain gate. Essentials tier by
# default — threat protection (Plus) is opt-in via advanced_security_mode.
# --------------------------------------------------------------------------
resource "aws_cognito_user_pool" "main" {
  name                     = var.name
  deletion_protection      = "ACTIVE"
  auto_verified_attributes = ["email"]

  username_attributes = ["email"]

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = true # no public self-service signup; users arrive via Google federation
  }

  user_pool_tier = var.user_pool_tier

  # Threat protection is a Plus-tier feature; omit the block entirely on
  # Essentials/Lite (advanced_security_mode = OFF) to avoid a tier conflict.
  dynamic "user_pool_add_ons" {
    for_each = var.advanced_security_mode == "OFF" ? [] : [1]
    content {
      advanced_security_mode = var.advanced_security_mode
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.presignup.arn

    dynamic "pre_token_generation_config" {
      for_each = var.mcp == null ? [] : [1]
      content {
        lambda_arn     = aws_lambda_function.pretoken[0].arn
        lambda_version = "V2_0"
      }
    }
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  tags = var.tags
}

# --------------------------------------------------------------------------
# Google federated IdP. client_id/secret from Secrets Manager.
# --------------------------------------------------------------------------
resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = local.google.client_id
    client_secret    = local.google.client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email          = "email"
    name           = "name"
    username       = "sub"
    email_verified = "email_verified"
    picture        = "picture" # Google profile photo -> Cognito `picture` -> ID token claim
  }
}

# --------------------------------------------------------------------------
# Hosted UI domain. (Roles are NOT modeled in Cognito — authz resolves from the
# Aurora app.access_roster by JWT email; the JWT only needs to carry identity.)
# --------------------------------------------------------------------------
resource "aws_cognito_user_pool_domain" "main" {
  domain       = local.domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

# --------------------------------------------------------------------------
# White-label hosted UI: auth.<env>.<domain_root>. Opt-in (custom_auth_domain).
# The prefix domain above is kept as a fallback (a pool may carry both). Cert
# MUST live in us-east-1 — Cognito custom domains are fronted by CloudFront.
# Prereq: the parent domain (<env>.<domain_root>) must already have an A record
# (the SPA stack provides it), else the custom-domain creation is rejected.
# --------------------------------------------------------------------------
resource "aws_acm_certificate" "auth" {
  count             = var.custom_auth_domain == "" ? 0 : 1
  provider          = aws.us_east_1
  domain_name       = var.custom_auth_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
    precondition {
      condition     = var.route53_zone_id != ""
      error_message = "custom_auth_domain is set but route53_zone_id is empty; both must be set together."
    }
  }
}

resource "aws_route53_record" "auth_cert_validation" {
  for_each = var.custom_auth_domain == "" ? {} : {
    for dvo in aws_acm_certificate.auth[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "auth" {
  count                   = var.custom_auth_domain == "" ? 0 : 1
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.auth[0].arn
  validation_record_fqdns = [for r in aws_route53_record.auth_cert_validation : r.fqdn]
}

resource "aws_cognito_user_pool_domain" "custom" {
  count           = var.custom_auth_domain == "" ? 0 : 1
  domain          = var.custom_auth_domain
  user_pool_id    = aws_cognito_user_pool.main.id
  certificate_arn = aws_acm_certificate_validation.auth[0].certificate_arn
}

# Alias the custom domain at the managed CloudFront distribution Cognito creates.
resource "aws_route53_record" "auth_alias_a" {
  count   = var.custom_auth_domain == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.custom_auth_domain
  type    = "A"

  alias {
    name                   = aws_cognito_user_pool_domain.custom[0].cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.custom[0].cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}

# --------------------------------------------------------------------------
# SPA app client — public (no secret), Authorization Code + PKCE.
# --------------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.name}-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false # public client; PKCE is used (Cognito enforces it for secret-less code flow)

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = [aws_cognito_identity_provider.google.provider_name]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  # Hosted-UI OAuth only — no direct username/password auth flows.
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"

  id_token_validity      = var.id_token_validity_minutes
  access_token_validity  = var.access_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

# --------------------------------------------------------------------------
# MCP resource server + public PKCE client (opt-in via var.mcp). The MCP
# Lambda verifies access tokens from this client only; SPA tokens are pinned
# to the SPA client and vice versa. Scopes come out as <identifier>/read and
# <identifier>/write. Longer refresh lifetime than the SPA so Glean users do
# not re-consent daily.
# --------------------------------------------------------------------------
resource "aws_cognito_resource_server" "mcp" {
  count        = var.mcp == null ? 0 : 1
  identifier   = var.mcp.resource_identifier
  name         = "${var.name}-mcp"
  user_pool_id = aws_cognito_user_pool.main.id

  scope {
    scope_name        = "read"
    scope_description = "Read portal data"
  }

  scope {
    scope_name        = "write"
    scope_description = "Create and update activities, mappings, and outreach"
  }
}

resource "aws_cognito_user_pool_client" "mcp" {
  count        = var.mcp == null ? 0 : 1
  name         = "${var.name}-mcp"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = concat(["openid", "email"], tolist(aws_cognito_resource_server.mcp[0].scope_identifiers))
  supported_identity_providers         = [aws_cognito_identity_provider.google.provider_name]

  callback_urls = var.mcp.callback_urls

  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"

  id_token_validity      = var.id_token_validity_minutes
  access_token_validity  = var.access_token_validity_minutes
  refresh_token_validity = var.mcp.refresh_token_validity_days

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}
