variable "name" {
  type        = string
  description = "Base name for the schedules + IAM role, e.g. <project>-aurora-<env>."
}

variable "cluster_identifier" {
  type        = string
  description = "DBClusterIdentifier passed to rds:ModifyDBCluster (the Serverless v2 cluster id)."
}

variable "cluster_arn" {
  type        = string
  description = "Cluster ARN the scheduler role is scoped to for rds:ModifyDBCluster."
}

variable "warm_min_capacity" {
  type        = number
  default     = 0.5
  description = "Minimum ACU during business hours — >0 keeps the cluster from auto-pausing (no cold start)."
}

variable "cool_min_capacity" {
  type        = number
  default     = 0
  description = "Minimum ACU outside business hours — 0 re-enables Serverless v2 auto-pause."
}

variable "max_capacity" {
  type        = number
  description = "Maximum ACU. Must match the cluster's configured max (ModifyDBCluster requires both min+max). Keep in sync with the aurora stack."
}

variable "warm_cron" {
  type        = string
  default     = "cron(0 9 ? * MON-FRI *)"
  description = "When to warm up. Default 09:00 on weekdays, in warm_timezone."
}

variable "warm_timezone" {
  type        = string
  default     = "Europe/London"
  description = "IANA timezone for warm_cron (DST-aware). Default UK, the earliest team start."
}

variable "cool_cron" {
  type        = string
  default     = "cron(0 17 ? * MON-FRI *)"
  description = "When to cool down. Default 17:00 on weekdays, in cool_timezone."
}

variable "cool_timezone" {
  type        = string
  default     = "America/Los_Angeles"
  description = "IANA timezone for cool_cron (DST-aware). Default US Pacific close of business."
}
