# Scheduled Aurora Serverless v2 warm/cool. Bumps the cluster's minimum ACU up during business
# hours so the team never hits the ~15-30s auto-pause cold start, and back to 0 (auto-pause) outside
# them to pay only storage overnight/weekends. Two EventBridge Scheduler schedules call
# rds:ModifyDBCluster directly (universal target — no Lambda). EventBridge Scheduler is used over
# classic EventBridge rules because it is timezone-aware (DST-correct) — the warm/cool times are
# anchored to Europe/London and America/Los_Angeles.
#
# Terraform still owns the cluster's baseline min_capacity (see the aurora stack); these schedules
# are the runtime source of truth between applies. Keep the baseline WARM (>=warm_min_capacity) so a
# stray aurora-stack apply can only ever leave it warm (extra cost), never cold (user-facing).

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

data "aws_iam_policy_document" "modify" {
  statement {
    actions   = ["rds:ModifyDBCluster"]
    resources = [var.cluster_arn]
  }
}

resource "aws_iam_role_policy" "modify" {
  name   = "modify-db-cluster"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.modify.json
}

locals {
  # EventBridge Scheduler universal target for an AWS SDK call.
  target_arn = "arn:aws:scheduler:::aws-sdk:rds:modifyDBCluster"
}

# min ACU -> warm (start of the UK business day).
resource "aws_scheduler_schedule" "warm" {
  name = "${var.name}-warm"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.warm_cron
  schedule_expression_timezone = var.warm_timezone

  target {
    arn      = local.target_arn
    role_arn = aws_iam_role.scheduler.arn
    input = jsonencode({
      DbClusterIdentifier = var.cluster_identifier
      ApplyImmediately    = true
      ServerlessV2ScalingConfiguration = {
        MinCapacity = var.warm_min_capacity
        MaxCapacity = var.max_capacity
      }
    })
  }
}

# min ACU -> 0, i.e. re-enable auto-pause (US Pacific close of business).
resource "aws_scheduler_schedule" "cool" {
  name = "${var.name}-cool"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.cool_cron
  schedule_expression_timezone = var.cool_timezone

  target {
    arn      = local.target_arn
    role_arn = aws_iam_role.scheduler.arn
    input = jsonencode({
      DbClusterIdentifier = var.cluster_identifier
      ApplyImmediately    = true
      ServerlessV2ScalingConfiguration = {
        MinCapacity = var.cool_min_capacity
        MaxCapacity = var.max_capacity
      }
    })
  }
}
