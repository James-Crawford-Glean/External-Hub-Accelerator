variable "github_org" { type = string }
variable "github_repo" { type = string }

variable "existing_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "Use this GitHub OIDC provider instead of creating one. Empty creates the provider."
}

# root.hcl merges these into every stack. This module does not branch on them.
variable "env" {
  type    = string
  default = ""
}
variable "aws_region" {
  type    = string
  default = ""
}
variable "aws_account_id" {
  type    = string
  default = ""
}
variable "project" {
  type        = string
  description = "Resource name prefix. Derives the role name and the S3 / DynamoDB prefixes CI may manage when those are not set explicitly."
}
variable "state_bucket_arn" { type = string }
variable "lock_table_arn" { type = string }

variable "role_name" {
  type        = string
  default     = ""
  description = "Deploy role name. Empty derives github-actions-<project>."
}

variable "trust_subject_patterns" {
  type        = list(string)
  default     = []
  description = <<-EOT
    Optional explicit list of GitHub OIDC sub-claim StringLike patterns. If
    empty (default), the trust falls back to "repo:<org>/<repo>:*" — bounded
    to this exact repo, permissive on the subject suffix. This default is a
    diagnostic safety net only; live configs should set this explicitly to
    the env-pinned form, e.g. ["repo:<org>/<repo>:environment:example"].
  EOT
}

variable "allowed_secret_value_read_arns" {
  type        = list(string)
  default     = []
  description = "Secret value ARN patterns CI may read at apply time for Terraform-managed service config."
}

variable "secret_value_write_arns" {
  type        = list(string)
  default     = []
  description = "Secret value ARN patterns CI may write. Empty denies every PutSecretValue."
}

variable "dynamodb_table_prefixes" {
  type        = list(string)
  default     = []
  description = "DynamoDB table name prefixes CI may create and update. Empty derives [project]."
}

variable "s3_bucket_prefixes" {
  type        = list(string)
  default     = []
  description = "S3 bucket name prefixes CI may manage, besides the state bucket. Empty derives [project]."
}

variable "additional_actions" {
  type        = list(string)
  default     = []
  description = "Extra IAM actions on * for services this account's stacks use and the shared allow-list does not."
}
