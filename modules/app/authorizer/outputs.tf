output "function_arn" {
  description = "Authorizer Lambda ARN. AppSync/API Gateway reference this when they attach it."
  value       = aws_lambda_function.this.arn
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "invoke_arn" {
  description = "Invoke ARN for API Gateway authorizer integration (authorizerUri)."
  value       = aws_lambda_function.this.invoke_arn
}

output "role_arn" {
  value = aws_iam_role.lambda.arn
}
