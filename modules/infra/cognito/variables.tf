variable "name" {
  description = "Resource name prefix (e.g. <project>-<env>)."
  type        = string
}

variable "domain_prefix" {
  description = "Cognito hosted-UI domain prefix (globally unique per region). Defaults to name."
  type        = string
  default     = ""
}

variable "callback_urls" {
  description = "OAuth redirect URIs for the SPA app client (localhost + the deployed SPA host)."
  type        = list(string)
}

variable "logout_urls" {
  description = "Post-logout redirect URIs for the SPA app client."
  type        = list(string)
}

variable "custom_auth_domain" {
  description = "White-label hosted-UI domain (e.g. auth.<env>.<domain_root>). Empty = use the Cognito prefix domain only. Requires route53_zone_id + the parent domain to already have an A record."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone for the custom_auth_domain cert validation + alias. Required when custom_auth_domain is set."
  type        = string
  default     = ""
}

variable "allowed_email_domains" {
  description = "Email-domain allowlist enforced by the pre-sign-up trigger. Empty = allow any."
  type        = list(string)
  default     = []
}

variable "google_secret_name" {
  description = "Secrets Manager name holding the Google OAuth client credentials, populated out-of-band before first apply."
  type        = string
}

variable "google_secret_json_key" {
  description = "Sub-key in the Google secret JSON that holds {client_id, client_secret} (the old perimeter stored them under 'web')."
  type        = string
  default     = "web"
}

variable "id_token_validity_minutes" {
  type    = number
  default = 60
}

variable "access_token_validity_minutes" {
  type    = number
  default = 60
}

variable "refresh_token_validity_days" {
  type    = number
  default = 1
}

variable "mcp" {
  description = "Opt-in OAuth 2.1 resource server + public PKCE app client for the MCP server. resource_identifier is the canonical MCP URI (becomes the scope prefix and the expected `aud`). callback_urls are the MCP host's redirect URIs (Glean's, plus localhost for manual PKCE tests). null = no MCP resources."
  type = object({
    resource_identifier         = string
    callback_urls               = list(string)
    refresh_token_validity_days = optional(number, 30)
  })
  default = null

  validation {
    condition     = var.mcp == null || can(regex("^https://", var.mcp.resource_identifier))
    error_message = "mcp.resource_identifier must be an https:// URI."
  }
}

variable "user_pool_tier" {
  description = "Cognito feature plan: LITE | ESSENTIALS | PLUS. Threat protection (advanced_security_mode) requires PLUS."
  type        = string
  default     = "ESSENTIALS"
}

variable "advanced_security_mode" {
  description = "Cognito threat protection: OFF | AUDIT | ENFORCED. Any non-OFF value requires user_pool_tier = PLUS."
  type        = string
  default     = "OFF"
}

variable "runtime" {
  type    = string
  default = "python3.13"
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
