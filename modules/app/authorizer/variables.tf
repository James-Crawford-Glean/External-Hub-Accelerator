variable "name" {
  type        = string
  description = "Authorizer Lambda name, e.g. <project>-authorizer-<env>."
}

variable "source_dir" {
  type        = string
  description = "Pre-built esbuild bundle dir (lambda-backend/dist/authorizer, index.handler)."
}

variable "runtime" {
  type    = string
  default = "nodejs20.x"
}

variable "cognito_issuer" {
  type        = string
  description = "Cognito OIDC issuer URL. The JWT path validates iss + fetches JWKS from here."
}

variable "cognito_client_id" {
  type        = string
  description = "SPA app client id. ID-token aud is pinned to this (same contract as the old OIDC authorizer)."
}

variable "cognito_mcp_resource" {
  type        = string
  default     = ""
  description = "Cognito resource-server identifier for the MCP server. When set, OAuth access tokens scoped <id>/read|write are accepted; empty disables the access-token path."
}

variable "ddb_table_prefix" {
  type        = string
  description = "DynamoDB table name prefix (DDB_TABLE_PREFIX) so the key store resolves <prefix>-api_keys."
}

variable "api_keys_table_arn" {
  type        = string
  description = "ARN of the api_keys table. Read access (incl. /index/* for the hash-index GSI) is granted on it."
}

variable "pepper_secret_name" {
  type        = string
  description = "Secrets Manager name of the HMAC pepper (e.g. <project>-<env>/api-key-pepper). Created out-of-band by a local admin, same as the Google OAuth slot; resolved here via a data lookup for the ARN. The value is read at runtime by the Lambda, never at apply."
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  type    = number
  default = 10
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "allowed_email_domains" {
  type        = list(string)
  default     = []
  description = "Email domains a verified Cognito token must belong to (second layer behind the pre-sign-up gate). Empty = any domain the pool admitted."
}
