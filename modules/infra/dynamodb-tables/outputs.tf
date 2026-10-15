output "table_names" {
  description = "Map of logical name -> full table name."
  value       = { for k, t in aws_dynamodb_table.this : k => t.name }
}

output "table_arns" {
  description = "Map of logical name -> table ARN. Use for IAM policy."
  value       = { for k, t in aws_dynamodb_table.this : k => t.arn }
}

output "name_prefix" {
  description = "Prefix that consumers (Lambdas) need as DDB_TABLE_PREFIX."
  value       = var.name_prefix
}
