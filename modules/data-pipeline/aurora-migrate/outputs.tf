output "function_name" {
  value = aws_lambda_function.this.function_name
}

# Dependent stacks (the sync workers' seed) depend on this stack so the schema
# exists first; this surfaces the migration result for visibility.
output "result" {
  value = aws_lambda_invocation.migrate.result
}
