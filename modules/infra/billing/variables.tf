variable "project" {
  type        = string
  description = "Project slug; prefixes resource names and the Project tag."
}

variable "env" {
  type        = string
  description = "Environment name. Drives the budget/dashboard names + the Env cost-allocation tag filter."
}

variable "monthly_budget_usd" {
  type        = number
  description = "Monthly cost budget (USD) for this env, filtered by the Env cost-allocation tag."
}

variable "aws_account_id" {
  type        = string
  description = "Account id, for the Cost Explorer deep-link in the dashboard text widget."
}
