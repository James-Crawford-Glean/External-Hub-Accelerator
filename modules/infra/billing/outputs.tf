output "billing_dashboard_name" {
  value       = aws_cloudwatch_dashboard.billing.dashboard_name
  description = "Billing dashboard name (<project>-<env>-billing)."
}

output "budget_name" {
  value = aws_budgets_budget.env.name
}
