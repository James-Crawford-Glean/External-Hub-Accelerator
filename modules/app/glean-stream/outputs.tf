output "api_origin_domain" {
  description = "Regional execute-api hostname for the CloudFront custom origin (no scheme, no stage)."
  value       = "${aws_api_gateway_rest_api.this.id}.execute-api.${data.aws_region.current.name}.amazonaws.com"
}

output "stage" {
  description = "REST API stage name. CloudFront sets origin_path = /<stage>."
  value       = aws_api_gateway_stage.this.stage_name
}

output "rest_api_id" {
  value = aws_api_gateway_rest_api.this.id
}

output "function_name" {
  value = aws_lambda_function.streamer.function_name
}

output "function_arn" {
  value = aws_lambda_function.streamer.arn
}

output "invoke_url" {
  description = "Direct execute-api invoke URL (internal; clients reach it via CloudFront)."
  value       = aws_api_gateway_stage.this.invoke_url
}
