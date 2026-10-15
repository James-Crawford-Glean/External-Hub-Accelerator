variable "name" {
  description = "Resource name prefix (e.g. <project>-aurora-migrate-<env>). Must start with `<project>-` for github-oidc IAM scoping."
  type        = string
}

variable "source_dir" {
  type        = string
  description = "Pre-built Node Lambda bundle dir (index.js) for the migrate worker."
}

variable "aurora_cluster_arn" {
  description = "Aurora cluster ARN; the RDS Data API resourceArn."
  type        = string
}

variable "aurora_secret_arn" {
  description = "RDS-managed master credentials secret ARN; the Data API secretArn."
  type        = string
}

variable "aurora_database" {
  description = "Database name the Data API targets."
  type        = string
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  description = "Seconds. DDL is fast; the budget mostly covers a Serverless v2 resume (~30s) on the first call after auto-pause."
  type        = number
  default     = 120
}

variable "log_retention_days" {
  type    = number
  default = 14
}
