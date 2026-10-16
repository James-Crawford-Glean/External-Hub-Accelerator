# Two CloudWatch dashboards per env: an overview of every stack and a
# performance view over the backend's EMF metrics. View-only; no alarms.
# Every identifier comes in as a variable so the module has no naming
# assumptions of its own.

locals {
  lambda_names      = var.lambda_function_names
  sync_lambda_names = var.scheduled_function_names
  aurora_id         = var.aurora_cluster_identifier

  # Per-function metric lines (one series per Lambda).
  inv_metrics     = [for n in local.lambda_names : ["AWS/Lambda", "Invocations", "FunctionName", n]]
  err_metrics     = [for n in local.lambda_names : ["AWS/Lambda", "Errors", "FunctionName", n]]
  dur_metrics     = [for n in local.lambda_names : ["AWS/Lambda", "Duration", "FunctionName", n]]
  thr_metrics     = [for n in local.lambda_names : ["AWS/Lambda", "Throttles", "FunctionName", n]]
  conc_metrics    = [for n in local.lambda_names : ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", n]]
  syncerr_metrics = [for n in local.sync_lambda_names : ["AWS/Lambda", "Errors", "FunctionName", n]]

  ddb_read  = [for t in var.dynamodb_table_names : ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", t]]
  ddb_write = [for t in var.dynamodb_table_names : ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", t]]
  ddb_throt = [for t in var.dynamodb_table_names : ["AWS/DynamoDB", "ThrottledRequests", "TableName", t]]

  widgets = concat([
    {
      type       = "text", x = 0, y = 0, width = 24, height = 1,
      properties = { markdown = "# ${var.project} — ${var.env} — overview   ·   region ${var.region}   ·   view-only (no alarms)" }
    },
    # --- AppSync ---
    {
      type = "metric", x = 0, y = 1, width = 12, height = 6,
      properties = {
        title = "AppSync — requests & errors", region = var.region, view = "timeSeries", stat = "Sum", period = 300,
        metrics = [
          ["AWS/AppSync", "5XXError", "GraphQLAPIId", var.appsync_api_id],
          ["AWS/AppSync", "4XXError", "GraphQLAPIId", var.appsync_api_id],
          ["AWS/AppSync", "Latency", "GraphQLAPIId", var.appsync_api_id, { stat = "SampleCount", label = "Requests" }],
        ]
      }
    },
    {
      type = "metric", x = 12, y = 1, width = 12, height = 6,
      properties = {
        title = "AppSync — latency", region = var.region, view = "timeSeries", period = 300,
        metrics = [
          ["AWS/AppSync", "Latency", "GraphQLAPIId", var.appsync_api_id, { stat = "p50", label = "p50" }],
          ["AWS/AppSync", "Latency", "GraphQLAPIId", var.appsync_api_id, { stat = "p90", label = "p90" }],
          ["AWS/AppSync", "Latency", "GraphQLAPIId", var.appsync_api_id, { stat = "p99", label = "p99" }],
        ]
      }
    },
    # --- Lambda (all functions) ---
    {
      type       = "metric", x = 0, y = 7, width = 12, height = 6,
      properties = { title = "Lambda — invocations", region = var.region, view = "timeSeries", stat = "Sum", period = 300, metrics = local.inv_metrics }
    },
    {
      type       = "metric", x = 12, y = 7, width = 12, height = 6,
      properties = { title = "Lambda — errors", region = var.region, view = "timeSeries", stat = "Sum", period = 300, metrics = local.err_metrics }
    },
    {
      type       = "metric", x = 0, y = 13, width = 8, height = 6,
      properties = { title = "Lambda — duration (p99)", region = var.region, view = "timeSeries", stat = "p99", period = 300, metrics = local.dur_metrics }
    },
    {
      type       = "metric", x = 8, y = 13, width = 8, height = 6,
      properties = { title = "Lambda — throttles", region = var.region, view = "timeSeries", stat = "Sum", period = 300, metrics = local.thr_metrics }
    },
    {
      type       = "metric", x = 16, y = 13, width = 8, height = 6,
      properties = { title = "Lambda — concurrent executions", region = var.region, view = "timeSeries", stat = "Maximum", period = 300, metrics = local.conc_metrics }
    },
    # --- Aurora Serverless v2 ---
    {
      type = "metric", x = 0, y = 19, width = 12, height = 6,
      properties = {
        title = "Aurora — ACU & CPU", region = var.region, view = "timeSeries", period = 300,
        metrics = [
          ["AWS/RDS", "ServerlessDatabaseCapacity", "DBClusterIdentifier", local.aurora_id, { stat = "Average", label = "ACU" }],
          ["AWS/RDS", "CPUUtilization", "DBClusterIdentifier", local.aurora_id, { stat = "Average", label = "CPU %" }],
        ]
      }
    },
    {
      type = "metric", x = 12, y = 19, width = 12, height = 6,
      properties = {
        title = "Aurora — connections & memory", region = var.region, view = "timeSeries", period = 300,
        metrics = [
          ["AWS/RDS", "DatabaseConnections", "DBClusterIdentifier", local.aurora_id, { stat = "Average" }],
          ["AWS/RDS", "FreeableMemory", "DBClusterIdentifier", local.aurora_id, { stat = "Average" }],
        ]
      }
    },
    {
      type = "metric", x = 0, y = 25, width = 8, height = 6,
      properties = {
        title   = "Aurora — volume bytes", region = var.region, view = "timeSeries", period = 3600,
        metrics = [["AWS/RDS", "VolumeBytesUsed", "DBClusterIdentifier", local.aurora_id, { stat = "Average" }]]
      }
    },
    ],
    # --- DynamoDB (only if tables provided) ---
    length(var.dynamodb_table_names) == 0 ? [] : [
      {
        type       = "metric", x = 8, y = 25, width = 8, height = 6,
        properties = { title = "DynamoDB — consumed capacity", region = var.region, view = "timeSeries", stat = "Sum", period = 300, metrics = concat(local.ddb_read, local.ddb_write) }
      },
      {
        type       = "metric", x = 16, y = 25, width = 8, height = 6,
        properties = { title = "DynamoDB — throttled requests", region = var.region, view = "timeSeries", stat = "Sum", period = 300, metrics = local.ddb_throt }
      },
    ],
    [
      # --- CloudFront (metrics are us-east-1 only) + Cognito ---
      {
        type = "metric", x = 0, y = 31, width = 12, height = 6,
        properties = {
          title = "CloudFront — requests & error rate", region = "us-east-1", view = "timeSeries", period = 300,
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Sum" }],
            ["AWS/CloudFront", "4xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Average" }],
            ["AWS/CloudFront", "5xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Average" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 31, width = 12, height = 6,
        properties = {
          title = "Cognito — sign-in success/failure", region = var.region, view = "timeSeries", stat = "Sum", period = 300,
          metrics = [
            ["AWS/Cognito", "SignInSuccesses", "UserPool", var.cognito_user_pool_id, "UserPoolClient", "ALL"],
            ["AWS/Cognito", "SignInThrottles", "UserPool", var.cognito_user_pool_id, "UserPoolClient", "ALL"],
          ]
        }
      },
      # --- S3 SPA bucket size + scheduled-job health glance ---
      {
        type = "metric", x = 0, y = 37, width = 12, height = 6,
        properties = {
          title = "S3 — SPA bucket size", region = var.region, view = "timeSeries", period = 86400,
          metrics = [
            ["AWS/S3", "BucketSizeBytes", "BucketName", var.spa_bucket_name, "StorageType", "StandardStorage", { stat = "Average" }],
            ["AWS/S3", "NumberOfObjects", "BucketName", var.spa_bucket_name, "StorageType", "AllStorageTypes", { stat = "Average" }],
          ]
        }
      },
    ],
    length(local.sync_lambda_names) == 0 ? [] : [
      {
        type = "metric", x = 12, y = 37, width = 12, height = 6,
        properties = {
          title   = "Scheduled jobs — errors in the last 24h", region = var.region, view = "singleValue", stat = "Sum", period = 86400,
          metrics = local.syncerr_metrics
        }
      },
  ])
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.project}-${var.env}-overview"
  dashboard_body = jsonencode({ widgets = local.widgets })
}

# --- Performance dashboard: backend EMF metrics + a RUM pointer ---
# EMF widgets use metric SEARCH so new resolver fields appear automatically,
# scoped to this env via the `env` dimension. RUM (client) metrics live in the
# RUM console's own app-monitor dashboard, linked from the header.
locals {
  perf_ns = var.perf_metrics_namespace

  perf_widgets = [
    {
      type = "text", x = 0, y = 0, width = 24, height = 2,
      properties = {
        markdown = "# ${var.project} — ${var.env} — performance   ·   region ${var.region}\nBackend resolver + Aurora timing (EMF, tagged `env`+`version`). Client web-vitals + custom events → [RUM console](https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#rum:dashboard/${var.rum_app_monitor_name})."
      }
    },
    {
      type = "metric", x = 0, y = 2, width = 12, height = 6,
      properties = {
        title   = "Resolver duration p95 by field (ms)", region = var.region, view = "timeSeries", period = 300,
        metrics = [[{ expression = "SEARCH('{${local.perf_ns},env,field,ok} MetricName=\"ResolverDuration\" env=\"${var.env}\"', 'p95', 300)", id = "r95", label = "" }]]
      }
    },
    {
      type = "metric", x = 12, y = 2, width = 12, height = 6,
      properties = {
        title   = "Resolver duration p50 by field (ms)", region = var.region, view = "timeSeries", period = 300,
        metrics = [[{ expression = "SEARCH('{${local.perf_ns},env,field,ok} MetricName=\"ResolverDuration\" env=\"${var.env}\"', 'p50', 300)", id = "r50", label = "" }]]
      }
    },
    {
      type = "metric", x = 0, y = 8, width = 12, height = 6,
      properties = {
        title   = "Aurora call duration p95 by kind (ms)", region = var.region, view = "timeSeries", period = 300,
        metrics = [[{ expression = "SEARCH('{${local.perf_ns},env,kind} MetricName=\"AuroraCallDuration\" env=\"${var.env}\"', 'p95', 300)", id = "a95", label = "" }]]
      }
    },
    {
      type = "metric", x = 12, y = 8, width = 12, height = 6,
      properties = {
        title   = "Resolver call volume by field", region = var.region, view = "timeSeries", stat = "SampleCount", period = 300,
        metrics = [[{ expression = "SEARCH('{${local.perf_ns},env,field,ok} MetricName=\"ResolverDuration\" env=\"${var.env}\"', 'SampleCount', 300)", id = "rc", label = "" }]]
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "perf" {
  dashboard_name = "${var.project}-${var.env}-perf"
  dashboard_body = jsonencode({ widgets = local.perf_widgets })
}
