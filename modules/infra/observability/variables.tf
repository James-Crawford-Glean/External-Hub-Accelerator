variable "project" {
  type        = string
  description = "Project slug; prefixes the dashboard names."
}

variable "env" {
  type        = string
  description = "Environment name. Drives dashboard names and the `env` dimension on EMF metrics."
}

variable "region" {
  type        = string
  description = "AWS region the resources live in (metrics region for everything except CloudFront, which is always us-east-1)."
}

variable "appsync_api_id" {
  type        = string
  description = "AppSync GraphQL API id (GraphQLAPIId dimension)."
}

variable "cognito_user_pool_id" {
  type        = string
  description = "Cognito user pool id (UserPool dimension)."
}

variable "cloudfront_distribution_id" {
  type        = string
  description = "SPA CloudFront distribution id (DistributionId dimension)."
}

variable "spa_bucket_name" {
  type        = string
  description = "SPA/logos S3 bucket name."
}

variable "aurora_cluster_identifier" {
  type        = string
  description = "Aurora cluster identifier (DBClusterIdentifier dimension)."
}

variable "lambda_function_names" {
  type        = list(string)
  description = "Every Lambda to chart on the overview (invocations, errors, duration, throttles, concurrency)."
}

variable "scheduled_function_names" {
  type        = list(string)
  default     = []
  description = "Subset of lambda_function_names that run on a schedule; charted as a 24h error count. Empty skips the widget."
}

variable "dynamodb_table_names" {
  type        = list(string)
  default     = []
  description = "DynamoDB table names to chart (TableName dimension). Empty skips the DynamoDB widgets."
}

variable "perf_metrics_namespace" {
  type        = string
  description = "CloudWatch EMF namespace the backend emits ResolverDuration / AuroraCallDuration into."
}

variable "rum_app_monitor_name" {
  type        = string
  default     = ""
  description = "CloudWatch RUM app monitor name, for the console deep link on the performance dashboard."
}
