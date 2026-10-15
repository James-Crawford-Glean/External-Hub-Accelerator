variable "name" {
  type        = string
  description = "Warmer Lambda name, e.g. <project>-warmer-<env>."
}

variable "source_dir" {
  type        = string
  description = "Pre-built esbuild bundle dir (lambda-backend/dist/workers/warmer, index.handler)."
}

variable "runtime" {
  type    = string
  default = "nodejs20.x"
}

variable "target_function_arns" {
  type        = list(string)
  description = "Request-path Lambda ARNs to keep warm (AppSync dispatcher + glean-stream). Also injected as APPSYNC_FN/STREAM_FN env."
}

variable "aurora_cluster_arn" {
  type        = string
  description = "Aurora cluster ARN — the warmer reads app.warmer_config (enabled/concurrency) via the Data API each run."
}

variable "aurora_secret_arn" {
  type = string
}

variable "aurora_database" {
  type = string
}

variable "schedule_expression" {
  type = string
  # Every 5 min, business hours EU-SOB -> PT-EOB, Mon-Fri (UTC baseline). Fixed
  # UTC drifts +/-1h across DST; the Fri-18:00-PT / Mon-08:00-CET edges are noted
  # in the ticket and accepted rather than over-engineered.
  default = "cron(0/5 7-23,0-1 ? * MON-FRI *)"
}

variable "log_retention_days" {
  type    = number
  default = 14
}
