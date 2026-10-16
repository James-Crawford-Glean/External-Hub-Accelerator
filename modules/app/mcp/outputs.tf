output "api_endpoint" {
  description = "HTTP API base endpoint (https://<id>.execute-api.<region>.amazonaws.com)."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_origin_domain" {
  description = "execute-api hostname for the CloudFront custom origin (no scheme, no stage)."
  value       = "${aws_apigatewayv2_api.this.id}.execute-api.${data.aws_region.current.name}.amazonaws.com"
}

output "stage" {
  description = "HTTP API stage name. CloudFront sets origin_path = /<stage>."
  value       = aws_apigatewayv2_stage.this.name
}

output "invoke_url" {
  description = "Stage invoke URL on the execute-api host (diagnostics). MCP endpoint is <invoke_url>/mcp."
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/${aws_apigatewayv2_stage.this.name}"
}

output "public_url" {
  description = "Public base URL on the custom domain. MCP endpoint is <public_url>/mcp; OAuth discovery is <public_url>/.well-known/*."
  value       = "https://${var.custom_domain}"
}

output "function_name" {
  value = aws_lambda_function.mcp.function_name
}

output "function_arn" {
  value = aws_lambda_function.mcp.arn
}
