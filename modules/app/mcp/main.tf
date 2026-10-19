# MCP server: a Node Lambda fronted by an HTTP API (API Gateway v2) on its own
# hostname. A POST /mcp carries a JSON-RPC MCP request; GET /mcp/health is a
# liveness probe; GET /logos serves cached logos to external tool callers.
#
# Auth has two layers:
#   - OAuth 2.1 (var.oauth, required). MCP hosts such as Glean discover the
#     server through RFC 8414 / 9728 metadata, register a client with RFC 7591
#     DCR, and send Cognito access tokens. The Lambda serves the discovery
#     routes and verifies bearers itself, because the gateway authorizer
#     cannot emit the 401 + WWW-Authenticate those hosts need.
#   - The unified authorizer (var.authorizer_invoke_arn, optional) as an HTTP
#     API REQUEST authorizer on POST /mcp and GET /logos, for opaque API keys
#     issued to service accounts. Leave it empty for an OAuth-only server.
#
# Aurora is reached over the RDS Data API; no VPC attachment.

data "aws_region" "current" {}

data "archive_file" "src" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.build/${var.name}.zip"
}

# --------------------------------------------------------------------------
# IAM
# --------------------------------------------------------------------------
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name}-lambda"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "aurora" {
  statement {
    sid = "AuroraDataApi"
    actions = [
      "rds-data:ExecuteStatement",
      "rds-data:BatchExecuteStatement",
      "rds-data:BeginTransaction",
      "rds-data:CommitTransaction",
      "rds-data:RollbackTransaction",
    ]
    resources = [var.aurora_cluster_arn]
  }

  statement {
    sid       = "GetAuroraSecret"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [var.aurora_secret_arn]
  }

  statement {
    sid       = "DecryptAuroraSecretKms"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["secretsmanager.*.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "aurora" {
  name   = "${var.name}-aurora"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.aurora.json
}

# Workers the MCP tools may invoke (async jobs kicked off from chat).
data "aws_iam_policy_document" "invoke_workers" {
  count = length(var.invoke_function_arns) == 0 ? 0 : 1

  statement {
    sid       = "InvokeWorkers"
    actions   = ["lambda:InvokeFunction"]
    resources = var.invoke_function_arns
  }
}

resource "aws_iam_role_policy" "invoke_workers" {
  count  = length(var.invoke_function_arns) == 0 ? 0 : 1
  name   = "${var.name}-invoke-workers"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.invoke_workers[0].json
}

# The /register shim is the only writer of app clients outside Terraform.
# List + Describe make re-registration idempotent (find by ClientName and
# return the existing client) instead of minting a client per call.
data "aws_iam_policy_document" "oauth" {
  statement {
    sid = "DcrUserPoolClients"
    actions = [
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:ListUserPoolClients",
    ]
    resources = [var.oauth.user_pool_arn]
  }
}

resource "aws_iam_role_policy" "oauth" {
  name   = "${var.name}-oauth"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.oauth.json
}

# --------------------------------------------------------------------------
# Lambda
# --------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "mcp" {
  function_name    = var.name
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = var.runtime
  filename         = data.archive_file.src.output_path
  source_code_hash = data.archive_file.src.output_base64sha256
  memory_size      = var.memory_size
  timeout          = var.timeout

  environment {
    variables = merge(
      {
        AURORA_CLUSTER_ARN        = var.aurora_cluster_arn
        AURORA_SECRET_ARN         = var.aurora_secret_arn
        AURORA_DATABASE           = var.aurora_database
        OAUTH_PUBLIC_URL          = var.oauth.public_url
        OAUTH_HOSTED_UI_URL       = var.oauth.hosted_ui_url
        OAUTH_RESOURCE_IDENTIFIER = var.oauth.resource_identifier
        OAUTH_REDIRECT_HOSTS      = join(",", var.oauth.redirect_hosts)
        COGNITO_ISSUER            = var.oauth.issuer
        COGNITO_USER_POOL_ID      = var.oauth.user_pool_id
        COGNITO_CLIENT_ID         = var.oauth.spa_client_id
        ALLOWED_EMAIL_DOMAINS     = join(",", var.allowed_email_domains)
        PORTAL_NAME               = var.portal_name
      },
      var.env_vars,
    )
  }

  depends_on = [
    aws_iam_role_policy_attachment.basic,
    aws_cloudwatch_log_group.lambda,
  ]
}

# --------------------------------------------------------------------------
# HTTP API. AWS_PROXY (payload v2) to the Lambda, which does its own
# method/path routing.
# --------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "this" {
  name          = var.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.mcp.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = var.integration_timeout_ms
}

locals {
  has_authorizer = var.authorizer_invoke_arn != ""
}

resource "aws_apigatewayv2_authorizer" "unified" {
  count                             = local.has_authorizer ? 1 : 0
  api_id                            = aws_apigatewayv2_api.this.id
  name                              = "${var.name}-authorizer"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = var.authorizer_invoke_arn
  identity_sources                  = ["$request.header.Authorization"]
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  authorizer_result_ttl_in_seconds  = var.authorizer_ttl_seconds
}

resource "aws_apigatewayv2_route" "mcp" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "POST /mcp"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"

  # Without the gateway authorizer the Lambda's own bearer verification is the
  # only gate, which is the OAuth-only configuration.
  authorization_type = local.has_authorizer ? "CUSTOM" : "NONE"
  authorizer_id      = local.has_authorizer ? aws_apigatewayv2_authorizer.unified[0].id : null
}

resource "aws_apigatewayv2_route" "logos" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "GET /logos"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"

  authorization_type = local.has_authorizer ? "CUSTOM" : "NONE"
  authorizer_id      = local.has_authorizer ? aws_apigatewayv2_authorizer.unified[0].id : null
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "GET /mcp/health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# OAuth discovery + registration are reached before a client holds any token,
# so they bypass the authorizer. The {proxy+} variants cover the RFC 8414 /
# 9728 path-suffixed spellings (.../oauth-protected-resource/mcp).
locals {
  oauth_open_routes = toset([
    "GET /.well-known/oauth-authorization-server",
    "GET /.well-known/oauth-authorization-server/{proxy+}",
    "GET /.well-known/oauth-protected-resource",
    "GET /.well-known/oauth-protected-resource/{proxy+}",
    "POST /register",
  ])
}

resource "aws_apigatewayv2_route" "oauth_open" {
  for_each  = local.oauth_open_routes
  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Stage access log: the only record of requests the Lambda never sees (gateway
# authorizer 403s, /register 429s, malformed routes), so the Discover, Register,
# and Authorize stages of a host rollout can be read from one place.
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}-access"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = var.stage_name
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      requestTime        = "$context.requestTime"
      httpMethod         = "$context.httpMethod"
      routeKey           = "$context.routeKey"
      path               = "$context.path"
      status             = "$context.status"
      sourceIp           = "$context.identity.sourceIp"
      userAgent          = "$context.identity.userAgent"
      integrationStatus  = "$context.integrationStatus"
      integrationLatency = "$context.integrationLatency"
      responseLatency    = "$context.responseLatency"
      authorizerError    = "$context.authorizer.error"
      errorMessage       = "$context.error.message"
    })
  }

  # /register mints Cognito app clients; throttle it so a scanner cannot fill
  # the pool's client quota.
  route_settings {
    route_key              = "POST /register"
    throttling_rate_limit  = var.oauth.register_rate_limit
    throttling_burst_limit = var.oauth.register_burst_limit
  }

  # UpdateStage 404s when route_settings names a route that does not exist
  # yet, so the throttled route must be created first.
  depends_on = [aws_apigatewayv2_route.oauth_open]
}

# --------------------------------------------------------------------------
# Custom hostname. HTTP API domains are regional, so the cert lives in this
# region. The API mapping has no key, so the stage root is the host root:
# https://<custom_domain>/mcp and /.well-known/* with no stage prefix, which
# is what the OAuth resource identifier requires.
# --------------------------------------------------------------------------
resource "aws_acm_certificate" "custom_domain" {
  domain_name       = var.custom_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.custom_domain.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "custom_domain" {
  certificate_arn         = aws_acm_certificate.custom_domain.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_apigatewayv2_domain_name" "this" {
  domain_name = var.custom_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.custom_domain.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  domain_name = aws_apigatewayv2_domain_name.this.id
  stage       = aws_apigatewayv2_stage.this.id
}

resource "aws_route53_record" "alias_a" {
  zone_id = var.route53_zone_id
  name    = var.custom_domain
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  zone_id = var.route53_zone_id
  name    = var.custom_domain
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mcp.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorizer" {
  count         = local.has_authorizer ? 1 : 0
  statement_id  = "AllowInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = var.authorizer_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.unified[0].id}"
}
