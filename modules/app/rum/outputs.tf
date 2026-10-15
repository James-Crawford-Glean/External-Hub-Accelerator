# Fed into the SPA build as VITE_RUM_* (non-secret) so the aws-rum-web client can initialize.
output "app_monitor_id" {
  value       = aws_rum_app_monitor.this.app_monitor_id
  description = "RUM app monitor id the web client initializes with (VITE_RUM_APP_MONITOR_ID)."
}

output "app_monitor_name" {
  value       = aws_rum_app_monitor.this.name
  description = "App monitor name (for CloudWatch console / dashboards)."
}

output "identity_pool_id" {
  value       = aws_cognito_identity_pool.rum.id
  description = "Cognito identity pool id for the RUM guest data-plane auth (VITE_RUM_IDENTITY_POOL_ID)."
}

output "guest_role_arn" {
  value       = aws_iam_role.guest.arn
  description = "Guest IAM role arn assumed for PutRumEvents (VITE_RUM_GUEST_ROLE_ARN)."
}

output "region" {
  # .name (not .region): the CI-pinned AWS provider predates the .region attribute.
  value       = data.aws_region.current.name
  description = "Region the app monitor lives in (VITE_RUM_REGION)."
}
