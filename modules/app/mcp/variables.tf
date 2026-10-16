variable "name" {
  type        = string
  description = "Function/API name prefix, e.g. <project>-mcp-<env>."
}

variable "source_dir" {
  type        = string
  description = "Pre-built Node Lambda bundle dir (index.js) for the MCP server."
}

variable "runtime" {
  type        = string
  default     = "nodejs22.x"
  description = "Node runtime. Must provide global fetch + AWS SDK v3 (>= nodejs18.x)."
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  type        = number
  default     = 25
  description = "Lambda timeout (s). Must stay below the 29s API Gateway integration ceiling, or a slow call is cut off client-side while the Lambda keeps running and a write may still land."
}

variable "integration_timeout_ms" {
  type        = number
  default     = 29000
  description = "API Gateway integration timeout (ms). Max is 29000 for non-streaming integrations."

  validation {
    condition     = var.integration_timeout_ms >= 50 && var.integration_timeout_ms <= 29000
    error_message = "integration_timeout_ms must be between 50 and 29000."
  }
}

variable "stage_name" {
  type    = string
  default = "live"
}

variable "aurora_cluster_arn" {
  type        = string
  description = "Aurora cluster ARN; the RDS Data API resourceArn."
}

variable "aurora_secret_arn" {
  type        = string
  description = "RDS-managed master credentials secret ARN; the Data API secretArn."
}

variable "aurora_database" {
  type        = string
  description = "Database name the Data API targets."
}

variable "invoke_function_arns" {
  type        = list(string)
  default     = []
  description = "Worker Lambda ARNs the MCP tools may invoke. Names reach the server through env_vars."
}

variable "env_vars" {
  type        = map(string)
  default     = {}
  description = "Extra env vars for the MCP Lambda."
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "custom_domain" {
  type        = string
  description = "Public hostname for the HTTP API, e.g. mcp.<env>.<domain_root>. Mapped to the stage root so /mcp and /.well-known/* resolve at the origin root. Must equal the host of oauth.public_url."
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone for custom_domain cert validation and alias records."
}

variable "authorizer_invoke_arn" {
  type        = string
  default     = ""
  description = "Invoke ARN of the unified authorizer Lambda. Set it to accept opaque API keys on POST /mcp and GET /logos alongside OAuth bearers; empty = OAuth only."
}

variable "authorizer_function_name" {
  type        = string
  default     = ""
  description = "Function name of the unified authorizer, for the invoke permission. Only used when authorizer_invoke_arn is set."
}

variable "authorizer_ttl_seconds" {
  type        = number
  default     = 60
  description = "How long API Gateway caches the authorizer result per identity source. Short so a revoked key stops working promptly."
}

variable "oauth" {
  description = <<-EOT
    OAuth 2.1 resource-server settings (MCP authorization spec). The Lambda serves
    RFC 8414 / 9728 metadata and an RFC 7591 /register shim over Cognito, and
    verifies Cognito access tokens itself. resource_identifier is the Cognito
    resource server's identifier (the cognito stack's mcp_resource_identifier
    output) and must equal public_url.
  EOT
  type = object({
    public_url           = string
    issuer               = string
    hosted_ui_url        = string
    user_pool_id         = string
    user_pool_arn        = string
    resource_identifier  = string
    spa_client_id        = optional(string, "")
    redirect_hosts       = optional(list(string), [])
    register_rate_limit  = optional(number, 1)
    register_burst_limit = optional(number, 5)
  })

  validation {
    condition     = can(regex("^https://[^/]+$", var.oauth.public_url))
    error_message = "oauth.public_url must be an https origin with no path or trailing slash."
  }
}

variable "allowed_email_domains" {
  type        = list(string)
  default     = []
  description = "Email domains a verified OAuth bearer must belong to. Empty = any domain the pool admitted."
}

variable "portal_name" {
  type        = string
  description = "Display name an MCP host shows for this server and that tool descriptions cite as the data source."
}
