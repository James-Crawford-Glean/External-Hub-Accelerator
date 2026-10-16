# A scheduled Node Lambda with Aurora Data API access: the shape every
# pull-from-upstream or push-to-Glean job takes. One module, many stacks; the
# worker's behaviour comes from its bundle and env vars, not from Terraform.
#
# Optional: read access to named secrets (upstream credentials, a Glean
# indexing token), an invoke on apply so a fresh environment is populated
# before the first scheduled run.

data "archive_file" "src" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.build/${var.name}.zip"
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

data "aws_secretsmanager_secret" "named" {
  for_each = toset(var.secret_names)
  name     = each.value
}

data "aws_iam_policy_document" "perms" {
  statement {
    sid       = "GetSecrets"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = concat([var.aurora_secret_arn], [for s in data.aws_secretsmanager_secret.named : s.arn])
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
}

resource "aws_iam_role_policy" "perms" {
  name   = "${var.name}-perms"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.perms.json
}

resource "aws_cloudwatch_log_group" "this" {
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
    variables = merge(
      {
        AURORA_CLUSTER_ARN = var.aurora_cluster_arn
        AURORA_SECRET_ARN  = var.aurora_secret_arn
        AURORA_DATABASE    = var.aurora_database
      },
      { for k, v in var.secret_env : k => data.aws_secretsmanager_secret.named[v].arn },
      var.env_vars,
    )
  }

  depends_on = [aws_cloudwatch_log_group.this]
}

resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.schedule_expression == "" ? 0 : 1
  name                = "${var.name}-schedule"
  description         = "Runs ${var.name} on a fixed cadence."
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "lambda" {
  count     = var.schedule_expression == "" ? 0 : 1
  rule      = aws_cloudwatch_event_rule.schedule[0].name
  target_id = "lambda"
  arn       = aws_lambda_function.this.arn
  input     = jsonencode(var.schedule_payload)
}

resource "aws_lambda_permission" "events" {
  count         = var.schedule_expression == "" ? 0 : 1
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[0].arn
}

# Re-runs only when the package changes; the worker is idempotent.
resource "aws_lambda_invocation" "on_apply" {
  count         = var.invoke_on_apply ? 1 : 0
  function_name = aws_lambda_function.this.function_name
  input         = jsonencode(var.invoke_on_apply_payload)
  triggers = {
    package = data.archive_file.src.output_base64sha256
  }
}
