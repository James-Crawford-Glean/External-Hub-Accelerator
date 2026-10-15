# GitHub Actions OIDC provider + a single role assumed by every CI workflow:
#   - infra plan / apply (Terragrunt run-all over live/<env>)
#   - SPA build + deploy (S3 sync + CloudFront invalidate)
#
# Trust pins on the GitHub Environment claim. When a workflow job declares
# `environment: <name>`, GitHub's OIDC token sub claim is
# `repo:<org>/<repo>:environment:<name>` (not the branch form). Branch-level
# gating is enforced separately by per-environment "Deployment branches and
# tags" rules in GitHub Settings -> Environments. The set of accepted sub
# claims is configurable via `trust_subject_patterns` for cases where a
# different shape is needed (e.g. a temporary repo:<org>/<repo>:* fallback
# while diagnosing trust issues).
#
# Permission model: deny-on-top-of-broad-allow.
#
# We deploy into a dedicated AWS account, so the account itself is the
# security boundary. Tightly scoping every action to project-* ARNs led
# to a maintenance treadmill (every new resource type forced a local
# admin apply of this stack to extend the policy).
#
# The policy is organized as:
#   1. DENY statements covering the truly load-bearing protections
#      (self-modification of the OIDC role, deletion of the OIDC
#      provider, secrets value access).
#   2. NARROW Allows for shared-with-other-projects resources where
#      cross-project corruption is a real concern (the state bucket).
#   3. BROAD Allows for normal infrastructure operations within the
#      account. Trust pinning on the OIDC provider keeps this role
#      assumable only by github-actions runs from this exact repo.
#
# Adding a new resource type to the project should NOT require touching
# this policy in the common case. If it does, it's because the new
# service isn't in the broad-allow service list — extend the list rather
# than adding a new fine-grained statement.
#
# CI is blocked from applying this stack via a guard step in
# .github/workflows/infra-deploy.yml; updates to the github-oidc role
# itself are local-admin-only.

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.existing_oidc_provider_arn == "" ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  role_name                = var.role_name != "" ? var.role_name : "github-actions-${var.project}"
  s3_bucket_prefixes       = length(var.s3_bucket_prefixes) > 0 ? var.s3_bucket_prefixes : [var.project]
  dynamodb_table_prefixes  = length(var.dynamodb_table_prefixes) > 0 ? var.dynamodb_table_prefixes : [var.project]
  default_subject_patterns = ["repo:${var.github_org}/${var.github_repo}:*"]
  subject_patterns         = length(var.trust_subject_patterns) > 0 ? var.trust_subject_patterns : local.default_subject_patterns
  allow_secret_value_reads = length(var.allowed_secret_value_read_arns) > 0
  oidc_provider_arn = coalesce(
    var.existing_oidc_provider_arn != "" ? var.existing_oidc_provider_arn : null,
    try(aws_iam_openid_connect_provider.github[0].arn, null),
  )
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.subject_patterns
    }
  }
}

resource "aws_iam_role" "spa_deploy" {
  name               = local.role_name
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

data "aws_iam_policy_document" "spa_deploy" {
  # ---------------------------------------------------------------------------
  # DENY statements (effect = "Deny" overrides any Allow below).
  # These are the load-bearing protections; everything else is broad allow.
  # ---------------------------------------------------------------------------

  # Forbid CI from destroying or hijacking its own role. Update-style ops
  # (PutRolePolicy, TagRole, etc.) are still allowed via the broad iam:*
  # below, so the github-oidc stack can still apply policy diffs to itself
  # under local-admin creds — but neither CI nor a compromised CI session
  # can delete the role, swap its trust policy, or self-attach managed
  # policies that escalate privilege.
  statement {
    sid    = "DenyDestructiveSelfModification"
    effect = "Deny"
    actions = [
      "iam:DeleteRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePermissionsBoundary",
      "iam:DeleteRolePermissionsBoundary",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
    ]
    resources = [aws_iam_role.spa_deploy.arn]
  }

  # Forbid OIDC provider destruction. Thumbprint/ClientID/tag updates are
  # allowed (CI can run github-oidc apply locally), but the provider can't
  # be deleted out from under itself.
  statement {
    sid    = "DenyOidcProviderDestruction"
    effect = "Deny"
    actions = [
      "iam:DeleteOpenIDConnectProvider",
    ]
    resources = [local.oidc_provider_arn]
  }

  # CI never writes secret VALUES unless secret_value_write_arns names them.
  # Slot create/update/delete/tag stays allowed. An empty write list denies every value write.
  dynamic "statement" {
    for_each = length(var.secret_value_write_arns) == 0 ? [1] : []
    content {
      sid    = "DenySecretValueMutation"
      effect = "Deny"
      actions = [
        "secretsmanager:PutSecretValue",
      ]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = length(var.secret_value_write_arns) == 0 ? [] : [1]
    content {
      sid    = "DenyUnapprovedSecretValueWrites"
      effect = "Deny"
      actions = [
        "secretsmanager:PutSecretValue",
      ]
      not_resources = var.secret_value_write_arns
    }
  }

  dynamic "statement" {
    for_each = local.allow_secret_value_reads ? [] : [1]
    content {
      sid       = "DenySecretValueReads"
      effect    = "Deny"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = local.allow_secret_value_reads ? [1] : []
    content {
      sid           = "DenyUnapprovedSecretValueReads"
      effect        = "Deny"
      actions       = ["secretsmanager:GetSecretValue"]
      not_resources = var.allowed_secret_value_read_arns
    }
  }

  # ---------------------------------------------------------------------------
  # NARROW ALLOWS — the state bucket, where blast radius matters most.
  # ---------------------------------------------------------------------------

  # Terragrunt state read/write, scoped to this project's key prefix so a
  # second project sharing the bucket can't be corrupted from this role.
  statement {
    sid = "StateBucketRead"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketVersioning",
      "s3:GetBucketLocation",
      "s3:GetEncryptionConfiguration",
    ]
    resources = [var.state_bucket_arn]
  }
  statement {
    sid       = "StateObjectReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.state_bucket_arn}/${var.project}/*"]
  }
  statement {
    sid = "StateLock"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
    ]
    resources = [var.lock_table_arn]
  }

  # ---------------------------------------------------------------------------
  # BROAD ALLOWS — within the dedicated AWS account, the account itself is
  # the security boundary. Trust pinning on the OIDC provider keeps this
  # role assumable only by github-actions runs from this exact repo. Adding
  # a new resource type to the project should not require touching this
  # policy. The DENY statements above keep the truly load-bearing
  # protections in place regardless of how broad these allows are.
  # ---------------------------------------------------------------------------

  # S3: any project-prefixed bucket. Covers the SPA bucket and any
  # future buckets (artifact buckets, attachment buckets, etc.).
  statement {
    sid     = "ManageProjectS3"
    actions = ["s3:*"]
    resources = flatten([
      for prefix in local.s3_bucket_prefixes : [
        "arn:aws:s3:::${prefix}-*",
        "arn:aws:s3:::${prefix}-*/*",
      ]
    ])
  }

  # DynamoDB: TABLE-level lifecycle on project-prefixed tables only.
  # Data-plane actions (GetItem/PutItem/Query/Scan/BatchGet/BatchWrite)
  # are intentionally absent — those are runtime ops on the Lambda role,
  # not CI's concern. CI manages the table SHAPE; Lambda manages the rows.
  statement {
    sid    = "ManageProjectDynamoDBTables"
    effect = "Allow"
    actions = [
      "dynamodb:CreateTable",
      "dynamodb:DeleteTable",
      "dynamodb:DescribeTable",
      "dynamodb:UpdateTable",
      "dynamodb:UpdateTimeToLive",
      "dynamodb:DescribeTimeToLive",
      "dynamodb:UpdateContinuousBackups",
      "dynamodb:DescribeContinuousBackups",
      "dynamodb:TagResource",
      "dynamodb:UntagResource",
      "dynamodb:ListTagsOfResource",
    ]
    resources = flatten([
      for prefix in local.dynamodb_table_prefixes : [
        "arn:aws:dynamodb:*:*:table/${prefix}-*",
        "arn:aws:dynamodb:*:*:table/${prefix}-*/index/*",
      ]
    ])
  }

  dynamic "statement" {
    for_each = length(var.additional_actions) == 0 ? [] : [1]
    content {
      sid       = "AllowStackServices"
      effect    = "Allow"
      actions   = var.additional_actions
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = length(var.secret_value_write_arns) == 0 ? [] : [1]
    content {
      sid       = "WriteApprovedSecretValues"
      actions   = ["secretsmanager:PutSecretValue"]
      resources = var.secret_value_write_arns
    }
  }

  # Compute, networking, observability, API surface — the stuff a project
  # of this shape needs day-to-day. Dropped fine-grained scoping; account
  # is the boundary.
  statement {
    sid    = "AllowProjectInfrastructure"
    effect = "Allow"
    actions = [
      # Compute / networking
      "ec2:*",
      "lambda:*",
      "rds:*",
      "cloudfront:*",
      "cognito-idp:*",
      # Cognito Identity Pools (distinct service from cognito-idp/user-pools) — the RUM
      # module creates a guest identity pool for anonymous browser event sends.
      "cognito-identity:*",
      # Domains + TLS — Route53 hosts our public zones, ACM issues the
      # certs CloudFront serves them with. Both are account-wide actions
      # the spa module (and any future custom-domain consumer) needs at
      # plan/apply time.
      "route53:*",
      "acm:*",
      # Observability
      "logs:*",
      "cloudwatch:*",
      # CloudWatch RUM — the perf-telemetry app monitor (real user monitoring).
      "rum:*",
      # Cost visibility — per-env AWS Budgets (milestone 2 #112).
      "budgets:*",
      # EventBridge — the account-sync schedule (rule + target + permission)
      # + the keep-alive warmer's EventBridge Scheduler (#114).
      "events:*",
      "scheduler:*",
      # API surface — both v1 (REST/edge-optimized) and v2 (HTTP/WebSocket)
      "apigateway:*",
      "apigatewayv2:*",
      # GraphQL — AppSync API + resolvers + functions + data sources.
      # AppSync ARNs include random api-ids that aren't predictable at
      # policy-write time, so we scope at action-level instead.
      "appsync:*",
      # Secrets metadata. NOT GetSecretValue / PutSecretValue (denied above).
      "secretsmanager:CreateSecret",
      "secretsmanager:UpdateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecrets",
      "secretsmanager:ListSecretVersionIds",
      "secretsmanager:TagResource",
      "secretsmanager:UntagResource",
      # IAM — enough to manage roles/policies for project Lambdas and to
      # apply this stack's own role updates locally. The DENY statements
      # above keep CI out of its own role's destructive lifecycle and
      # the OIDC provider's deletion.
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListRoleTags",
      "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:PassRole",
      "iam:CreateServiceLinkedRole",
      "iam:GetOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProviderThumbprint",
      "iam:AddClientIDToOpenIDConnectProvider",
      "iam:RemoveClientIDFromOpenIDConnectProvider",
      "iam:TagOpenIDConnectProvider",
      "iam:UntagOpenIDConnectProvider",
      # KMS for Secrets Manager + KMS-backed services. No condition — in a
      # dedicated account, all KMS keys are project keys.
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = local.allow_secret_value_reads ? [1] : []
    content {
      sid       = "ReadApplyTimeConfigSecrets"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = var.allowed_secret_value_read_arns
    }
  }
}

resource "aws_iam_role_policy" "spa_deploy" {
  name   = "${local.role_name}-policy"
  role   = aws_iam_role.spa_deploy.id
  policy = data.aws_iam_policy_document.spa_deploy.json
}
