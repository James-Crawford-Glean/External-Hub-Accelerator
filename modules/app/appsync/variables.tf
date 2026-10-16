variable "name" {
  description = "Resource name prefix (e.g. <project>-graphql-<env>)."
  type        = string
}

variable "schema_path" {
  description = "Path to schema.graphql: the API definition and, via parse-schema.py, the resolver wiring."
  type        = string
}

variable "source_dir" {
  description = "Pre-built Node Lambda bundle dir for the dispatcher (index.js)."
  type        = string
}

variable "runtime" {
  type    = string
  default = "nodejs20.x"
}

variable "authorizer_function_arn" {
  description = "ARN of the unified Lambda authorizer (Cognito JWTs + opaque API keys). AppSync's primary auth mode."
  type        = string
}

variable "authorizer_function_name" {
  description = "Authorizer Lambda name. aws_lambda_permission.function_name expects a name, not an ARN."
  type        = string
}

variable "authorizer_result_ttl_seconds" {
  description = "Default TTL for cached authorizer results. 0 = rely on the authorizer's per-response ttlOverride."
  type        = number
  default     = 0
}

variable "api_key_pepper_secret_name" {
  description = "HMAC pepper secret name (<project>-<env>/api-key-pepper) the dispatcher reads to hash API keys on create. Populated out-of-band. Empty disables API-key management."
  type        = string
  default     = ""
}

variable "ddb_table_arns" {
  description = "Map of DynamoDB logical name -> ARN from the dynamodb stack. Scopes the dispatcher's IAM."
  type        = map(string)
  default     = {}
}

variable "ddb_table_prefix" {
  description = "Table-name prefix the backend uses to build full table names (must match the dynamodb stack)."
  type        = string
  default     = ""
}

variable "logo_bucket_arn" {
  description = "S3 bucket ARN where cached logos and avatars are written (the SPA bucket). Empty disables the grant."
  type        = string
  default     = ""
}

variable "logo_bucket_name" {
  type    = string
  default = ""
}

variable "logo_cdn_url_prefix" {
  description = "URL prefix where logo objects are served, e.g. https://<spa_domain>. The backend returns <prefix>/<key>."
  type        = string
  default     = ""
}

variable "aurora_cluster_arn" {
  description = "Aurora cluster ARN; the RDS Data API resourceArn."
  type        = string
}

variable "aurora_secret_arn" {
  description = "RDS-managed master credentials secret ARN; the Data API secretArn."
  type        = string
}

variable "aurora_database" {
  description = "Database name the Data API targets."
  type        = string
}

variable "exports_worker_dir" {
  description = "Pre-built Node bundle dir for the CSV export worker. Empty disables async exports (no bucket, no worker)."
  type        = string
  default     = ""
}

variable "exports_retention_days" {
  type    = number
  default = 7
}

variable "invoke_function_arns" {
  description = "Worker Lambda ARNs the dispatcher may invoke on demand. Names reach the backend through env_vars."
  type        = list(string)
  default     = []
}

variable "env_vars" {
  description = "Extra env vars for the dispatcher Lambda."
  type        = map(string)
  default     = {}
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  type    = number
  default = 30
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "graphql_domain" {
  description = "White-label AppSync custom domain, e.g. gql.<env>.<domain_root>. Empty keeps the native AppSync endpoint."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone for the custom-domain certificate validation and CNAME. Required when graphql_domain is set."
  type        = string
  default     = ""
}
