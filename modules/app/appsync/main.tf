# AppSync GraphQL API with schema-driven dispatch to one Node Lambda.
#
#   backend/schema.graphql               single source of truth
#       parse-schema.py                  classifies each Query/Mutation field
#         data.external.manifest         {Type.field -> list | object | mutation | custom}
#       for_each over manifest:
#         aws_appsync_resolver           (PIPELINE; code = resolvers/<kind>.js)
#           pipeline_config:             [aws_appsync_function.dispatch]
#             aws_appsync_function       (functions/dispatch.js -> Lambda invoke)
#               dispatcher Lambda        (resolves Type.field to a handler at cold start)
#
# Adding a field: edit schema.graphql and write the resolver in the backend.
# Terraform picks up the new field on the next plan. Adding middleware
# (require_admin, audit_log): add an aws_appsync_function and compose it
# before/after dispatch in pipeline_config; resolver code is unchanged.
#
# Auth: AppSync's primary mode is the unified Lambda authorizer, which accepts
# Cognito ID tokens (people) and opaque API keys (machines) and returns the
# resolved principal in resolverContext. AWS_IAM stays as a secondary provider
# for SigV4-signed callers (CI, integration tests).

data "archive_file" "dispatcher" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.build/${var.name}.zip"
}

data "archive_file" "export_worker" {
  count       = local.exports_enabled ? 1 : 0
  type        = "zip"
  source_dir  = var.exports_worker_dir
  output_path = "${path.module}/.build/${var.name}-export.zip"
}

locals {
  exports_enabled = var.exports_worker_dir != ""

  pepper_env = var.api_key_pepper_secret_name == "" ? {} : {
    API_KEY_PEPPER_SECRET = data.aws_secretsmanager_secret.pepper[0].arn
  }

  exports_env = local.exports_enabled ? {
    EXPORTS_BUCKET_NAME     = aws_s3_bucket.exports[0].bucket
    EXPORTS_WORKER_FUNCTION = aws_lambda_function.export_worker[0].function_name
  } : {}

  dispatcher_env = merge(
    local.pepper_env,
    local.exports_env,
    {
      ENV                 = var.name
      DDB_TABLE_PREFIX    = var.ddb_table_prefix
      LOGO_BUCKET_NAME    = var.logo_bucket_name
      LOGO_CDN_URL_PREFIX = var.logo_cdn_url_prefix
      AURORA_CLUSTER_ARN  = var.aurora_cluster_arn
      AURORA_SECRET_ARN   = var.aurora_secret_arn
      AURORA_DATABASE     = var.aurora_database
    },
    var.env_vars,
  )
}

# --------------------------------------------------------------------------
# Resolver manifest from schema.graphql.
# --------------------------------------------------------------------------
data "external" "manifest" {
  program = ["python3", "${path.module}/parse-schema.py"]
  query = {
    schema_path = var.schema_path
  }
}

locals {
  manifest = jsondecode(data.external.manifest.result.manifest_json)
}

# --------------------------------------------------------------------------
# IAM
# --------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_trust" {
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
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# API-key HMAC pepper, read at runtime by createApiKey. Gated on the secret name.
data "aws_secretsmanager_secret" "pepper" {
  count = var.api_key_pepper_secret_name == "" ? 0 : 1
  name  = var.api_key_pepper_secret_name
}

data "aws_iam_policy_document" "pepper" {
  count = var.api_key_pepper_secret_name == "" ? 0 : 1

  statement {
    sid       = "GetApiKeyPepper"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [data.aws_secretsmanager_secret.pepper[0].arn]
  }

  statement {
    sid       = "DecryptPepperKms"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["secretsmanager.*.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "pepper" {
  count  = var.api_key_pepper_secret_name == "" ? 0 : 1
  name   = "${var.name}-api-key-pepper"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.pepper[0].json
}

# DynamoDB: scoped to the ARNs the dynamodb stack exports, plus /index/* so
# resolvers can Query GSIs. Scan is granted on api_keys only (admin listing of
# a small table), never across every table.
data "aws_iam_policy_document" "ddb" {
  count = length(var.ddb_table_arns) == 0 ? 0 : 1

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = concat(
      values(var.ddb_table_arns),
      [for arn in values(var.ddb_table_arns) : "${arn}/index/*"],
    )
  }

  dynamic "statement" {
    for_each = contains(keys(var.ddb_table_arns), "api_keys") ? [1] : []
    content {
      sid       = "ScanApiKeys"
      actions   = ["dynamodb:Scan"]
      resources = [var.ddb_table_arns["api_keys"]]
    }
  }
}

resource "aws_iam_role_policy" "ddb" {
  count  = length(var.ddb_table_arns) == 0 ? 0 : 1
  name   = "${var.name}-ddb"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.ddb[0].json
}

# SPA bucket: PutObject under the logos/ and avatars/ prefixes only. Reads go
# through the SPA distribution's OAC; this role never reads the bucket.
data "aws_iam_policy_document" "logo_bucket" {
  count = var.logo_bucket_arn == "" ? 0 : 1

  statement {
    actions = ["s3:PutObject"]
    resources = [
      "${var.logo_bucket_arn}/logos/*",
      "${var.logo_bucket_arn}/avatars/*",
    ]
  }
}

resource "aws_iam_role_policy" "logo_bucket" {
  count  = var.logo_bucket_arn == "" ? 0 : 1
  name   = "${var.name}-logo-bucket"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.logo_bucket[0].json
}

# Aurora over the RDS Data API: no VPC attachment needed.
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

# Workers the dispatcher may invoke on demand (admin "run now" buttons,
# async jobs). Pass their names via env_vars; this grant is scoped to the ARNs.
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

data "aws_iam_policy_document" "appsync_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["appsync.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "appsync" {
  name               = "${var.name}-appsync"
  assume_role_policy = data.aws_iam_policy_document.appsync_trust.json
}

data "aws_iam_policy_document" "appsync_invoke_lambda" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.dispatcher.arn]
  }
}

resource "aws_iam_role_policy" "appsync_invoke_lambda" {
  name   = "${var.name}-appsync-invoke"
  role   = aws_iam_role.appsync.id
  policy = data.aws_iam_policy_document.appsync_invoke_lambda.json
}

# --------------------------------------------------------------------------
# Log groups
# --------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "dispatcher" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "appsync" {
  name              = "/aws/appsync/apis/${var.name}"
  retention_in_days = var.log_retention_days
}

# --------------------------------------------------------------------------
# Dispatcher Lambda. Not in the VPC: Aurora is reached over the Data API.
# Auth is settled by AppSync before a request reaches here.
# --------------------------------------------------------------------------
resource "aws_lambda_function" "dispatcher" {
  function_name    = var.name
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = var.runtime
  filename         = data.archive_file.dispatcher.output_path
  source_code_hash = data.archive_file.dispatcher.output_base64sha256
  memory_size      = var.memory_size
  timeout          = var.timeout

  environment {
    variables = local.dispatcher_env
  }

  depends_on = [aws_cloudwatch_log_group.dispatcher]
}

# --------------------------------------------------------------------------
# Async CSV exports (optional). requestExport inserts a job row and async-
# invokes the worker; the worker writes the CSV to this bucket; exportJob
# returns a presigned GET URL. Objects expire after a week.
# --------------------------------------------------------------------------
resource "aws_s3_bucket" "exports" {
  count  = local.exports_enabled ? 1 : 0
  bucket = "${var.name}-exports"
}

resource "aws_s3_bucket_public_access_block" "exports" {
  count                   = local.exports_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.exports[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  count  = local.exports_enabled ? 1 : 0
  bucket = aws_s3_bucket.exports[0].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  count  = local.exports_enabled ? 1 : 0
  bucket = aws_s3_bucket.exports[0].id
  rule {
    id     = "expire-exports"
    status = "Enabled"
    filter {}
    expiration { days = var.exports_retention_days }
  }
}

resource "aws_cloudwatch_log_group" "export_worker" {
  count             = local.exports_enabled ? 1 : 0
  name              = "/aws/lambda/${var.name}-export"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "export_worker" {
  count            = local.exports_enabled ? 1 : 0
  function_name    = "${var.name}-export"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = var.runtime
  filename         = data.archive_file.export_worker[0].output_path
  source_code_hash = data.archive_file.export_worker[0].output_base64sha256
  memory_size      = var.memory_size
  timeout          = 300

  environment {
    variables = {
      AURORA_CLUSTER_ARN  = var.aurora_cluster_arn
      AURORA_SECRET_ARN   = var.aurora_secret_arn
      AURORA_DATABASE     = var.aurora_database
      EXPORTS_BUCKET_NAME = aws_s3_bucket.exports[0].bucket
    }
  }

  depends_on = [aws_cloudwatch_log_group.export_worker]
}

data "aws_iam_policy_document" "exports" {
  count = local.exports_enabled ? 1 : 0

  statement {
    sid       = "ExportsBucket"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.exports[0].arn}/*"]
  }
  statement {
    sid       = "InvokeExportWorker"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.export_worker[0].arn]
  }
}

resource "aws_iam_role_policy" "exports" {
  count  = local.exports_enabled ? 1 : 0
  name   = "${var.name}-exports"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.exports[0].json
}

# --------------------------------------------------------------------------
# AppSync API.
# --------------------------------------------------------------------------
resource "aws_appsync_graphql_api" "main" {
  name                = var.name
  authentication_type = "AWS_LAMBDA"
  schema              = file(var.schema_path)

  lambda_authorizer_config {
    authorizer_uri = var.authorizer_function_arn
    # The authorizer sets ttlOverride per response (60s authorized, 0 denied);
    # this default stays 0 so nothing is cached without it.
    authorizer_result_ttl_in_seconds = var.authorizer_result_ttl_seconds
  }

  additional_authentication_provider {
    authentication_type = "AWS_IAM"
  }

  log_config {
    cloudwatch_logs_role_arn = aws_iam_role.appsync_logs.arn
    field_log_level          = "ERROR"
    exclude_verbose_content  = true
  }

  xray_enabled = false
}

resource "aws_lambda_permission" "appsync_authorizer" {
  statement_id  = "AllowAppSyncInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = var.authorizer_function_name
  principal     = "appsync.amazonaws.com"
  source_arn    = aws_appsync_graphql_api.main.arn
}

# --------------------------------------------------------------------------
# White-label GraphQL endpoint. AppSync custom domains need an ACM cert in
# us-east-1 (the managed endpoint is CloudFront-backed). The native endpoint
# stays available as a fallback output.
# --------------------------------------------------------------------------
resource "aws_acm_certificate" "graphql" {
  count             = var.graphql_domain == "" ? 0 : 1
  provider          = aws.us_east_1
  domain_name       = var.graphql_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
    precondition {
      condition     = var.route53_zone_id != ""
      error_message = "graphql_domain is set but route53_zone_id is empty; both must be set together."
    }
  }
}

resource "aws_route53_record" "graphql_cert_validation" {
  for_each = var.graphql_domain == "" ? {} : {
    for dvo in aws_acm_certificate.graphql[0].domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "graphql" {
  count                   = var.graphql_domain == "" ? 0 : 1
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.graphql[0].arn
  validation_record_fqdns = [for r in aws_route53_record.graphql_cert_validation : r.fqdn]
}

resource "aws_appsync_domain_name" "graphql" {
  count           = var.graphql_domain == "" ? 0 : 1
  domain_name     = var.graphql_domain
  certificate_arn = aws_acm_certificate_validation.graphql[0].certificate_arn
  description     = "White-label GraphQL endpoint for ${var.name}"
}

resource "aws_appsync_domain_name_api_association" "graphql" {
  count       = var.graphql_domain == "" ? 0 : 1
  domain_name = aws_appsync_domain_name.graphql[0].domain_name
  api_id      = aws_appsync_graphql_api.main.id
}

resource "aws_route53_record" "graphql_alias" {
  count   = var.graphql_domain == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.graphql_domain
  type    = "CNAME"
  ttl     = 300
  records = [aws_appsync_domain_name.graphql[0].appsync_domain_name]
}

data "aws_iam_policy_document" "appsync_logs_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["appsync.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "appsync_logs" {
  name               = "${var.name}-appsync-logs"
  assume_role_policy = data.aws_iam_policy_document.appsync_logs_trust.json
}

resource "aws_iam_role_policy_attachment" "appsync_logs" {
  role       = aws_iam_role.appsync_logs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppSyncPushToCloudWatchLogs"
}

# --------------------------------------------------------------------------
# Lambda data source + the shared pipeline function every resolver chains.
# --------------------------------------------------------------------------
resource "aws_appsync_datasource" "lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "lambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync.arn

  lambda_config {
    function_arn = aws_lambda_function.dispatcher.arn
  }
}

resource "aws_appsync_function" "dispatch" {
  api_id      = aws_appsync_graphql_api.main.id
  name        = "dispatch"
  description = "Invokes the dispatcher Lambda. Reused by every resolver."
  data_source = aws_appsync_datasource.lambda.name

  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }

  code = file("${path.module}/functions/dispatch.js")
}

# One pipeline resolver per schema field. Resolver code is the before/after
# template for its kind; pipeline_config chains the functions that do the
# work (today: dispatch only).
resource "aws_appsync_resolver" "this" {
  for_each = local.manifest

  api_id = aws_appsync_graphql_api.main.id
  type   = split(".", each.key)[0]
  field  = split(".", each.key)[1]
  kind   = "PIPELINE"

  pipeline_config {
    functions = [aws_appsync_function.dispatch.function_id]
  }

  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }

  code = file(
    each.value == "custom"
    ? "${path.module}/resolvers/custom/${each.key}.js"
    : "${path.module}/resolvers/${each.value}.js"
  )
}
