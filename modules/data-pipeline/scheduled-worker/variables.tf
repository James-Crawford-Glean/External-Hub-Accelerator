variable "name" {
  type        = string
  description = "Function name, e.g. <project>-item-sync-<env>."
}

variable "source_dir" {
  type        = string
  description = "Pre-built Node Lambda bundle dir (index.js)."
}

variable "runtime" {
  type    = string
  default = "nodejs20.x"
}

variable "aurora_cluster_arn" { type = string }
variable "aurora_secret_arn" { type = string }
variable "aurora_database" { type = string }

variable "secret_names" {
  type        = list(string)
  default     = []
  description = "Secrets Manager names the worker may read at runtime (populated out-of-band)."
}

variable "secret_env" {
  type        = map(string)
  default     = {}
  description = "Env var name -> secret name (from secret_names). The var receives the secret's ARN."
}

variable "env_vars" {
  type    = map(string)
  default = {}
}

variable "schedule_expression" {
  type        = string
  default     = ""
  description = "EventBridge schedule (rate(...) or cron(...)). Empty = invoke-only, no schedule."
}

variable "schedule_payload" {
  type        = map(any)
  default     = {}
  description = "Event payload each scheduled run receives."
}

variable "invoke_on_apply" {
  type        = bool
  default     = false
  description = "Invoke once during apply when the package changes, so a fresh env has data before the first scheduled run."
}

variable "invoke_on_apply_payload" {
  type    = map(any)
  default = {}
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  type    = number
  default = 300
}

variable "log_retention_days" {
  type    = number
  default = 14
}
