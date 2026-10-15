output "secret_arns" {
  description = "Map of slot name to secret ARN. Consumed by Lambda/Aurora roles via remote state to grant GetSecretValue on specific ARNs."
  value       = { for k, s in aws_secretsmanager_secret.slot : k => s.arn }
}
