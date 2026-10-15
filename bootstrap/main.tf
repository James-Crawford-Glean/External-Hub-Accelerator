# Bootstraps the Terraform state backend for this project in one AWS account.
#
# - Bucket:     <project>-tf-state-<account_id>
# - Lock table: <project>-tf-locks (used by this bootstrap only; live/ stacks
#               lock with the S3-native lockfile and never touch the table)
#
# Self-rehoming: after the first apply on local state, this stack's own state
# is migrated into the bucket it just created. After that, every operator
# works against the same remote state.
#
# Use bootstrap.sh in this directory; do NOT call terraform directly the
# first time.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

variable "project" { type = string }
variable "aws_region" { type = string }
variable "aws_account_id" { type = string }

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform-bootstrap"
    }
  }
}

locals {
  state_bucket = "${var.project}-tf-state-${var.aws_account_id}"
  lock_table   = "${var.project}-tf-locks"
}

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket

  # Destroying the state bucket destroys every stack's state record.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "lock" {
  name         = local.lock_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "state_bucket" { value = aws_s3_bucket.state.id }
output "lock_table" { value = aws_dynamodb_table.lock.name }
