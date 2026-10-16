output "dashboard_name" {
  value       = aws_cloudwatch_dashboard.this.dashboard_name
  description = "Overview dashboard name (<project>-<env>-overview)."
}

output "dashboard_arn" {
  value = aws_cloudwatch_dashboard.this.dashboard_arn
}

output "perf_dashboard_name" {
  value       = aws_cloudwatch_dashboard.perf.dashboard_name
  description = "Performance dashboard name (<project>-<env>-perf)."
}
