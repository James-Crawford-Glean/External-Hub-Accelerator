variable "project" {
  type        = string
  description = "Project slug; prefixes resource names and the Project tag."
}

variable "database_name" {
  type        = string
  description = "Initial database name. Ignored when restoring from a snapshot."
}

variable "name" {
  type        = string
  description = "Cluster identifier (e.g. <project>-aurora-<env>). Must start with `<project>-` so the github-oidc IAM resource scoping matches."
}

variable "env" {
  type        = string
  description = "Environment slug (dev/staging/prod)."
}

variable "engine_version" {
  type        = string
  default     = "16.11"
  description = "Aurora PostgreSQL engine version. 16.4+ for pg_cron support. RDS auto-applies minor upgrades; bump this to match what's actually running before re-applying (downgrades aren't allowed)."
}

variable "db_subnet_group_name" {
  type        = string
  description = "DB subnet group from the network stack. Must span >=2 AZs."
}

variable "vpc_id" {
  type        = string
  description = "VPC ID from the network stack. Used to scope the cluster security group."
}

variable "app_security_group_ids" {
  type        = list(string)
  default     = []
  description = "SG IDs allowed to connect to Aurora on 5432. Empty until the Phase 3 Lambda stack creates one. Empty = nothing reaches the DB, which is the correct default while no consumer exists."
}

variable "master_username" {
  type        = string
  default     = "portal_admin"
  description = "DB master username. Used only for break-glass; Lambdas authenticate via IAM in Phase 3."
}

variable "snapshot_identifier" {
  type        = string
  default     = null
  description = "If set, restore the cluster from this DB cluster snapshot (seed an isolated env from another env's data). Create-time only. Leave null for a fresh cluster; when set, database_name/master_username are inherited from the snapshot and must not be passed."
}

variable "min_capacity" {
  type        = number
  default     = 0
  description = "Minimum ACUs. 0 enables Aurora Serverless v2 auto-pause (engine 16.3+, provider 5.79+) — cluster fully pauses after `var.seconds_until_auto_pause` of inactivity, paying only storage. First query after pause takes ~15-30s while ACUs ramp; the Data API surfaces a transient `DatabaseResumingException` during that window. Set to 0.5 for staging/prod where the latency hit is unacceptable."
}

variable "max_capacity" {
  type        = number
  default     = 1.0
  description = "Maximum ACUs. 1.0 caps dev worst-case at ~$0.12/hr; raise for staging/prod. With auto-pause we only pay this rate while actively serving."
}

variable "seconds_until_auto_pause" {
  type        = number
  default     = 3600
  description = "Idle seconds before the cluster pauses to 0 ACUs (only applies when `min_capacity = 0`). Range 300-86400. 3600 (1 hour) tolerates lunch breaks without forcing a resume; bootstrap/test cycles stay warm."
}

variable "backup_retention_days" {
  type        = number
  default     = 1
  description = "Days of automated backups to keep. 1 (the AWS minimum) for dev — we don't recover dev data, the bootstrap script reseeds. Raise to 7+ for staging/prod."
}

variable "deletion_protection" {
  type        = bool
  default     = false
  description = "Off in dev so a fresh apply can replace the cluster cleanly. Flip to true in prod."
}

variable "enable_data_api" {
  type        = bool
  default     = true
  description = "Enable the RDS Data API (HTTPS endpoint) on the cluster. On in dev so the bootstrap script can apply schema/seed from a laptop without a bastion or VPN. Authentication uses the RDS-managed master credentials secret (see `manage_master_user_password` above). Cost is zero when idle; per-call charges only. Turn off for prod once Lambdas inside the VPC are the only consumer."
}
