# CloudWatch RUM app monitor for the SPA, plus the Cognito identity pool that lets
# the browser client send events anonymously (a guest role scoped to rum:PutRumEvents only).
#
# Managed RUM retains end-user data for 30 days then auto-deletes — that IS the feature's TTL,
# so cw_log_enabled stays off (no PII copied to a longer-lived Logs group). custom_events is
# ENABLED so the app's recordEvent() custom events are ingested.
# See plans/perf-telemetry-design.md (§10, ADR-1/§11).

data "aws_region" "current" {}

# --- Cognito identity pool: anonymous (guest) identities for the RUM data plane ---
resource "aws_cognito_identity_pool" "rum" {
  # IdentityPoolName allows only word chars + spaces — hyphens are rejected.
  identity_pool_name               = replace(var.name, "-", "_")
  allow_unauthenticated_identities = true
}

data "aws_iam_policy_document" "guest_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["cognito-identity.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "cognito-identity.amazonaws.com:aud"
      values   = [aws_cognito_identity_pool.rum.id]
    }
    condition {
      test     = "ForAnyValue:StringLike"
      variable = "cognito-identity.amazonaws.com:amr"
      values   = ["unauthenticated"]
    }
  }
}

resource "aws_iam_role" "guest" {
  name               = "${var.name}-guest"
  assume_role_policy = data.aws_iam_policy_document.guest_trust.json
}

# Least-privilege: the browser guest role may ONLY put events to this app monitor.
data "aws_iam_policy_document" "put_events" {
  statement {
    actions   = ["rum:PutRumEvents"]
    resources = [aws_rum_app_monitor.this.arn]
  }
}

resource "aws_iam_role_policy" "put_events" {
  name   = "${var.name}-put-events"
  role   = aws_iam_role.guest.id
  policy = data.aws_iam_policy_document.put_events.json
}

resource "aws_cognito_identity_pool_roles_attachment" "rum" {
  identity_pool_id = aws_cognito_identity_pool.rum.id
  roles = {
    unauthenticated = aws_iam_role.guest.arn
  }
}

# --- The RUM app monitor ---
# `domain` and `domain_list` are mutually exclusive in the API — one is required. Staying on
# the scalar for the single-host case keeps existing monitors an in-place update rather than a
# replacement (a replacement mints a new app_monitor_id, which is baked into the SPA at build
# time and would need a rebuild to pick up).
resource "aws_rum_app_monitor" "this" {
  name           = var.name
  domain         = length(var.domains) == 1 ? var.domains[0] : null
  domain_list    = length(var.domains) > 1 ? var.domains : null
  cw_log_enabled = false # native 30-day retention only; never copy PII to CloudWatch Logs

  app_monitor_configuration {
    allow_cookies       = true
    enable_xray         = false # the SPA correlates via its own request-id header, not X-Ray
    session_sample_rate = var.session_sample_rate
    telemetries         = var.telemetries
    identity_pool_id    = aws_cognito_identity_pool.rum.id
    guest_role_arn      = aws_iam_role.guest.arn
  }

  custom_events {
    status = "ENABLED" # required for recordEvent (custom events)
  }
}
