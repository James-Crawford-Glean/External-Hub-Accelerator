variable "project" {
  type        = string
  description = "Project slug; prefixes resource names and the Project tag."
}

variable "name" {
  type        = string
  description = "Stack name prefix (e.g. <project>-secrets-<env>). Not used directly in resource names — secret names come from `var.env` + `var.secret_names` — but kept for tagging consistency with sibling stacks."
}

variable "env" {
  type        = string
  description = "Environment slug (dev/staging/prod). Becomes the first segment of the secret name path: <project>-<env>/<slot>."
}

variable "secret_names" {
  type        = list(string)
  default     = []
  description = "List of slot names. Each becomes a secret at `<project>-<env>/<name>`. Add a new slot here, apply, then run `aws secretsmanager put-secret-value` from local admin."
}

variable "recovery_window_days" {
  type        = number
  default     = 7
  description = "Days before a deleted secret is permanently destroyed. AWS default is 30; we use 7 for dev to keep mistakes recoverable for a week without holding deleted slots forever."
}
