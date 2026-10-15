# Glean chat streaming proxy: a Node Lambda fronted by a regional REST API in
# response streaming mode (responseTransferMode = STREAM, GA Nov 2025). The SPA
# reaches it same-origin via CloudFront /glean-api/*; the REST API's Cognito
# User Pools authorizer validates the SPA's ID token. The Lambda fetches a fresh
# Glean token from the graphql dispatcher (internal token RPC, IAM-gated invoke),
# then streams Glean's NDJSON chat response back as SSE.
#
# Why a REST API (not a Function URL or HTTP API): only the REST API combines
# native Cognito auth + WAF-ready perimeter + the 15-min STREAM integration. The
# regional endpoint's idle timeout is 5 min; ~10s heartbeats keep it open.
#
# Not in a VPC — needs Internet egress to Glean + the Lambda control plane. A
# client abort does NOT stop the function (it bills until Glean finishes); the
# Lambda timeout bounds that.

data "aws_region" "current" {}

# --------------------------------------------------------------------------
# Code zip: the pre-built esbuild bundle dir (index.js + map). AWS SDK v3 +
# global fetch come from the Node runtime; @libs/glean is bundled in.
# --------------------------------------------------------------------------
data "archive_file" "src" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.build/${var.name}.zip"
}

# --------------------------------------------------------------------------
# IAM: basic execution + Aurora Data API (the folded handler resolves the
# per-user Glean token from Aurora via @libs/glean, replacing the old
# cross-lambda token RPC).
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
  count = var.aurora_cluster_arn == "" ? 0 : 1

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
  count  = var.aurora_cluster_arn == "" ? 0 : 1
  name   = "${var.name}-aurora"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.aurora[0].json
}

# --------------------------------------------------------------------------
# Streaming Lambda.
# --------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "streamer" {
  function_name    = var.name
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = var.runtime
  filename         = data.archive_file.src.output_path
  source_code_hash = data.archive_file.src.output_base64sha256
  memory_size      = var.memory_size
  timeout          = var.timeout

  environment {
    variables = merge({
      AURORA_CLUSTER_ARN = var.aurora_cluster_arn
      AURORA_SECRET_ARN  = var.aurora_secret_arn
      AURORA_DATABASE    = var.aurora_database
    }, var.env_vars)
  }

  depends_on = [
    aws_iam_role_policy_attachment.basic,
    aws_cloudwatch_log_group.lambda,
  ]
}

# --------------------------------------------------------------------------
# Regional REST API (OpenAPI body import). The streaming bits API Gateway needs
# live in x-amazon-apigateway-integration: responseTransferMode = STREAM and the
# /response-streaming-invocations URI (tells API Gateway to use Lambda's
# InvokeWithResponseStream API). The Cognito authorizer is wired the same way.
#
# Resource path is /glean-api/draft so that, with the CloudFront origin_path of
# /<stage>, the SPA's /glean-api/draft lands on /<stage>/glean-api/draft.
# --------------------------------------------------------------------------
locals {
  stream_uri = format(
    "arn:aws:apigateway:%s:lambda:path/2021-11-15/functions/%s/response-streaming-invocations",
    data.aws_region.current.name,
    aws_lambda_function.streamer.arn,
  )

  openapi = {
    "openapi" = "3.0.1"
    "info"    = { "title" = var.name, "version" = "1.0" }
    "paths" = {
      "/glean-api/draft" = {
        "post" = {
          "security"  = [{ "CognitoUserPools" = [] }]
          "responses" = { "200" = { "description" = "OK" } }
          "x-amazon-apigateway-integration" = {
            "type"                 = "aws_proxy"
            "httpMethod"           = "POST"
            "uri"                  = local.stream_uri
            "responseTransferMode" = "STREAM"
            "timeoutInMillis"      = var.stream_timeout_ms
            "passthroughBehavior"  = "when_no_match"
          }
        }
      }
    }
    "components" = {
      "securitySchemes" = {
        "CognitoUserPools" = {
          "type"                         = "apiKey"
          "name"                         = "Authorization"
          "in"                           = "header"
          "x-amazon-apigateway-authtype" = "cognito_user_pools"
          "x-amazon-apigateway-authorizer" = {
            "type"         = "cognito_user_pools"
            "providerARNs" = [var.user_pool_arn]
          }
        }
      }
    }
  }
}

resource "aws_api_gateway_rest_api" "this" {
  name              = var.name
  body              = jsonencode(local.openapi)
  put_rest_api_mode = "overwrite"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # Redeploy whenever the API shape (or the integration target) changes.
  triggers = {
    redeploy = sha1(jsonencode(local.openapi))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.stage_name
}

# API Gateway -> Lambda. InvokeWithResponseStream is authorized by
# lambda:InvokeFunction, so the standard resource policy grant covers streaming.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.streamer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}
