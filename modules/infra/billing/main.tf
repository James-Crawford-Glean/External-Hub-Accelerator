# Per-env cost visibility in a single shared account: an AWS Budget filtered by the
# Env cost-allocation tag (the per-env number of record), plus a billing dashboard
# for trend context. No SNS subscribers yet (alerting deferred per the epic).
# Requires the Env tag to be activated as a cost-allocation tag in Billing (#112
# Phase A, a one-time manual/console step) before the budget/CE show tagged spend.

# Budget scoped to Env=<env>. Budgets is a global service; the default provider is fine.
resource "aws_budgets_budget" "env" {
  name         = "${var.project}-${var.env}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # user:<TagKey>$<TagValue> — the activated Env cost-allocation tag.
  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Env$%s", var.env)]
  }
  # No notification{} block — alerting deferred; the budget still tracks actual vs
  # limit in-console and via Cost Explorer.
}

# CloudWatch billing metrics (AWS/Billing EstimatedCharges) are emitted ONLY in
# us-east-1 and CANNOT be filtered by tag — so this dashboard shows the account-wide
# service breakdown for trend context; the per-ENV number comes from the Budget /
# Cost Explorer (tag-filtered) above. The text widget makes that explicit.
locals {
  svc         = ["AWSLambda", "AmazonRDS", "AWSAppSync", "AmazonS3", "AmazonCloudFront", "AmazonDynamoDB", "AmazonCognito", "AWSDataTransfer"]
  svc_metrics = [for s in local.svc : ["AWS/Billing", "EstimatedCharges", "ServiceName", s, "Currency", "USD"]]

  ce_url     = "https://us-east-1.console.aws.amazon.com/cost-management/home#/cost-explorer?groupBy=Service&filter=%5B%7B%22dimension%22:%7B%22id%22:%22TagKeyValue%22%7D,%22values%22:%5B%22Env%24${var.env}%22%5D%7D%5D"
  budget_url = "https://us-east-1.console.aws.amazon.com/billing/home#/budgets"

  widgets = [
    {
      type = "text", x = 0, y = 0, width = 24, height = 3,
      properties = {
        markdown = join("\n", [
          "# ${var.project} — ${var.env} — billing",
          "**Per-env spend of record = the [AWS Budget](${local.budget_url}) `${var.project}-${var.env}-monthly` (limit $${var.monthly_budget_usd}/mo) + [Cost Explorer filtered by Env=${var.env}](${local.ce_url}).**",
          "CloudWatch billing metrics below are **account-wide** (can't be tag-filtered) — service breakdown for trend context only. Do NOT read the account total as the ${var.env} total.",
        ])
      }
    },
    {
      type = "metric", x = 0, y = 3, width = 12, height = 6,
      properties = {
        title   = "Account EstimatedCharges (total, USD)", region = "us-east-1", view = "timeSeries", stat = "Maximum", period = 21600,
        metrics = [["AWS/Billing", "EstimatedCharges", "Currency", "USD"]]
      }
    },
    {
      type = "metric", x = 12, y = 3, width = 12, height = 6,
      properties = {
        title   = "Account EstimatedCharges by service (USD)", region = "us-east-1", view = "timeSeries", stat = "Maximum", period = 21600,
        metrics = local.svc_metrics
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "billing" {
  provider       = aws.us_east_1
  dashboard_name = "${var.project}-${var.env}-billing"
  dashboard_body = jsonencode({ widgets = local.widgets })
}
