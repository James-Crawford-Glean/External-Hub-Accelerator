output "api_id" {
  value = aws_appsync_graphql_api.main.id
}

output "native_graphql_endpoint" {
  description = "Native AppSync GraphQL endpoint, kept as a fallback for rollout and diagnostics."
  value       = aws_appsync_graphql_api.main.uris["GRAPHQL"]
}

output "graphql_endpoint" {
  description = "Active GraphQL endpoint. The white-label domain takes precedence when configured."
  value       = var.graphql_domain != "" ? "https://${var.graphql_domain}/graphql" : aws_appsync_graphql_api.main.uris["GRAPHQL"]
}

output "graphql_domain" {
  description = "White-label GraphQL hostname, or empty when the native endpoint is active."
  value       = var.graphql_domain
}

output "realtime_endpoint" {
  description = "AppSync subscription (websocket) endpoint."
  value       = aws_appsync_graphql_api.main.uris["REALTIME"]
}

output "resolver_count" {
  description = "Number of resolvers wired from schema.graphql."
  value       = length(local.manifest)
}

output "dispatcher_function_name" {
  value = aws_lambda_function.dispatcher.function_name
}

output "dispatcher_function_arn" {
  value = aws_lambda_function.dispatcher.arn
}

output "export_worker_function_name" {
  description = "CSV export worker name, or null when exports are disabled."
  value       = one(aws_lambda_function.export_worker[*].function_name)
}
