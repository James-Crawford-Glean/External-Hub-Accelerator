# Aurora Serverless v2 PostgreSQL cluster.
#
# Engine 16.11 — pg_cron is supported on 16.4+. RDS auto-applies minor
# upgrades, so the running version drifts ahead of the pin; bump
# var.engine_version up (never down — RDS rejects minor downgrades) before
# re-applying to keep the module in sync with reality.
#
# Capacity is set as ACUs (Aurora Capacity Units). 0.5 = ~1 GB RAM / ~0.5 vCPU,
# 2.0 = ~4 GB / ~2 vCPU. Dev runs at the floor most of the time; the cluster
# scales up under load and back down within minutes.
#
# Master password is generated and managed by RDS itself
# (`manage_master_user_password = true`). RDS provisions a Secrets Manager
# secret at cluster-create time, owns rotation, and exposes the ARN via
# `master_user_secret[0].secret_arn`. The bootstrap script reads that ARN and
# hands it to the Data API, which resolves the credentials internally — no
# human ever sees the password and no separate `put-secret-value` step is
# needed. CI keeps zero secret-read/write permissions; the only IAM role that
# can read the secret is whatever local-admin role runs the bootstrap.
#
# Networking: cluster lives in private subnets via the network stack's DB
# subnet group. The cluster's security group accepts 5432 from
# `var.app_security_group_ids`. An empty list means nothing in the VPC can
# reach the DB — correct default until a consumer Lambda is wired in via
# its security group.
#
# IAM database authentication is enabled so Lambda execution roles can
# connect without ever reading the master password — they sign a
# short-lived token from their execution role instead. Master password
# stays for break-glass admin access only.

locals {
  common_tags = {
    Project = var.project
    Env     = var.env
    Stack   = var.name
  }
}

resource "aws_security_group" "cluster" {
  name        = "${var.name}-cluster"
  description = "Aurora cluster ingress - 5432 from approved app SGs only."
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${var.name}-cluster-sg" })
}

# One ingress rule per app SG. Using aws_security_group_rule (not inline)
# so the list can grow over time without forcing SG replacement.
resource "aws_security_group_rule" "cluster_ingress_from_apps" {
  for_each = toset(var.app_security_group_ids)

  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = each.value
  security_group_id        = aws_security_group.cluster.id
  description              = "Aurora 5432 from app SG ${each.value}"
}

resource "aws_rds_cluster" "this" {
  cluster_identifier = var.name
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = var.engine_version

  # Seed an isolated env from a snapshot of another env. On restore, database_name
  # and master_username are inherited from the snapshot and cannot be re-declared.
  snapshot_identifier = var.snapshot_identifier
  database_name       = var.snapshot_identifier == null ? var.database_name : null
  master_username     = var.snapshot_identifier == null ? var.master_username : null

  manage_master_user_password = true

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = [aws_security_group.cluster.id]

  iam_database_authentication_enabled = true
  storage_encrypted                   = true
  backup_retention_period             = var.backup_retention_days
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection

  enable_http_endpoint = var.enable_data_api

  serverlessv2_scaling_configuration {
    min_capacity             = var.min_capacity
    max_capacity             = var.max_capacity
    seconds_until_auto_pause = var.min_capacity == 0 ? var.seconds_until_auto_pause : null
  }

  tags = merge(local.common_tags, { Name = var.name })
}

resource "aws_rds_cluster_instance" "this" {
  identifier         = "${var.name}-1"
  cluster_identifier = aws_rds_cluster.this.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.this.engine
  engine_version     = aws_rds_cluster.this.engine_version

  performance_insights_enabled = true
  publicly_accessible          = false

  tags = merge(local.common_tags, { Name = "${var.name}-1" })
}
