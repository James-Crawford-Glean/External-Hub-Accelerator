# Unified request authorizer Lambda. Validates the bearer on every API request:
# a Cognito ID token (people) or an opaque API key (machines), resolving it to a
# principal returned in the authorizer context. Shared by AppSync and the HTTP
# API — which attach it as their authorizer in a follow-up. This stack only
# creates the function + its least-priv role (read api_keys, read the pepper).
#
# Bundle is prebuilt by esbuild (lambda-backend/dist/authorizer, index.handler);
# archive_file zips it at apply, same as the sibling Node stacks.

data "archive_file" "src" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.build/${var.name}.zip"
}

# Pepper is created out-of-band (local admin), like the Google OAuth slot. Resolve
# its ARN by name for the IAM grant + env; the value is read at runtime, not here.
data "aws_secretsmanager_secret" "pepper" {
  name = var.pepper_secret_name
}

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

# Read-only on the api_keys table + its hash-index GSI (the key lookup path),
# plus GetSecretValue on the pepper secret and the KMS decrypt that implies.
data "aws_iam_policy_document" "perms" {
  statement {
    sid       = "ReadApiKeys"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [var.api_keys_table_arn, "${var.api_keys_table_arn}/index/*"]
  }

  # Best-effort last_used_at stamp on each verified key (base table only).
  statement {
    sid       = "TouchLastUsed"
    actions   = ["dynamodb:UpdateItem"]
    resources = [var.api_keys_table_arn]
  }

  statement {
    sid       = "GetPepperSecret"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [data.aws_secretsmanager_secret.pepper.arn]
  }

  statement {
    sid       = "DecryptSecretsKms"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["secretsmanager.*.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "perms" {
  name   = "${var.name}-perms"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.perms.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  function_name    = var.name
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = var.runtime
  filename         = data.archive_file.src.output_path
  source_code_hash = data.archive_file.src.output_base64sha256
  memory_size      = var.memory_size
  timeout          = var.timeout

  environment {
    variables = {
      COGNITO_ISSUER        = var.cognito_issuer
      COGNITO_CLIENT_ID     = var.cognito_client_id
      COGNITO_MCP_RESOURCE  = var.cognito_mcp_resource
      DDB_TABLE_PREFIX      = var.ddb_table_prefix
      API_KEY_PEPPER_SECRET = data.aws_secretsmanager_secret.pepper.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}
