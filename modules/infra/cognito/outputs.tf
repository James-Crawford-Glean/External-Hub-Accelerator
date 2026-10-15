output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.main.arn
}

output "app_client_id" {
  description = "SPA public app client id. The `aud` claim verifiers check against."
  value       = aws_cognito_user_pool_client.spa.id
}

output "issuer_url" {
  description = "OIDC issuer. AppSync OIDC + HTTP API JWT authorizer point here."
  value       = local.issuer
}

output "jwks_url" {
  value = "${local.issuer}/.well-known/jwks.json"
}

output "hosted_ui_domain" {
  description = "Active hosted-UI domain host (custom white-label when set, else the Cognito prefix domain)."
  value       = local.active_hosted_domain
}

output "hosted_ui_url" {
  value = "https://${local.active_hosted_domain}"
}

output "oauth_authorize_url" {
  description = "Authorization endpoint an MCP host (Glean) is configured with."
  value       = "https://${local.active_hosted_domain}/oauth2/authorize"
}

output "oauth_token_url" {
  description = "Token endpoint an MCP host (Glean) is configured with."
  value       = "https://${local.active_hosted_domain}/oauth2/token"
}

output "mcp_client_id" {
  description = "MCP public app client id. The MCP Lambda's access-token verifier pins `client_id` to this. null when var.mcp is unset."
  value       = one(aws_cognito_user_pool_client.mcp[*].id)
}

output "mcp_resource_identifier" {
  description = "Canonical MCP resource URI; scope prefix and expected `aud`. null when var.mcp is unset."
  value       = one(aws_cognito_resource_server.mcp[*].identifier)
}

output "mcp_scope_identifiers" {
  description = "Full scope strings (<identifier>/read, <identifier>/write) to enter in the MCP host's OAuth config."
  value       = one(aws_cognito_resource_server.mcp[*].scope_identifiers)
}
