variable "name" {
  type        = string
  description = "Function/API name prefix. e.g. <project>-glean-stream-<env>."
}

variable "source_dir" {
  type        = string
  description = "Absolute path to the pre-built esbuild bundle dir (lambda-backend/dist/stream, containing index.js). Zipped whole; handler is index.handler. @libs/glean is bundled in; AWS SDK v3 + fetch ship in the Node runtime."
}

variable "runtime" {
  type        = string
  default     = "nodejs22.x"
  description = "Node runtime. Must provide global fetch + awslambda.streamifyResponse + AWS SDK v3 (>= nodejs18.x)."
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  type        = number
  default     = 300
  description = "Lambda timeout (s). A draft is short; the streaming integration caps at 900s. A client abort does NOT stop the function, so keep this tight to bound runaway billing."
}

variable "stream_timeout_ms" {
  type        = number
  default     = 300000
  description = "API Gateway integration timeout (ms) for the STREAM integration. Max 900000."

  validation {
    condition     = var.stream_timeout_ms >= 50 && var.stream_timeout_ms <= 900000
    error_message = "stream_timeout_ms must be between 50 and 900000."
  }
}

variable "stage_name" {
  type        = string
  default     = "live"
  description = "REST API stage. CloudFront mounts this as the origin_path (/<stage>) so the SPA's /glean-api/draft maps to /<stage>/glean-api/draft."
}

variable "user_pool_arn" {
  type        = string
  description = "Cognito user pool ARN. The REST API's COGNITO_USER_POOLS authorizer validates the SPA's ID token against it."
}

variable "aurora_cluster_arn" {
  type        = string
  default     = ""
  description = "Aurora cluster ARN — Data API resourceArn. @libs/glean reads the per-user Glean token from Aurora. Empty disables the Aurora IAM."
}

variable "aurora_secret_arn" {
  type        = string
  default     = ""
  description = "RDS-managed master credentials secret ARN — Data API secretArn."
}

variable "aurora_database" {
  type        = string
  description = "Database name the Data API targets."
}

variable "env_vars" {
  type        = map(string)
  default     = {}
  description = "Extra env vars for the streaming Lambda — the GLEAN_* config (GLEAN_BASE_URL/GLEAN_SCOPES/GLEAN_REDIRECT_URIS) @libs/glean reads."
}

variable "log_retention_days" {
  type    = number
  default = 14
}
