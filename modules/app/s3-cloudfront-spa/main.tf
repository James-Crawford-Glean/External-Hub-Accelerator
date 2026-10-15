# Private S3 bucket fronted by a CloudFront distribution with Origin Access
# Control, a custom domain (optional), and multi-app SPA routing.
#
# Edge logic runs as a Python Lambda@Edge viewer-request handler
# (modules/.../edge/). It does routing only: host canonicalisation, root ->
# default app, per-app SPA fallback. The edge does no auth. Data access is
# gated where the data lives: AppSync and the API Gateway stages verify
# Cognito-issued JWTs. The static SPA shell carries no secrets.
#
# /api/* and /glean-api/* are routed via ordered cache behaviors to the
# regional API origins so the browser sees one origin.

resource "aws_s3_bucket" "spa" {
  bucket = var.name
}

# Every hostname this distribution answers on. `custom_domain` owns the cert CN and the
# primary alias records; the rest ride along as SANs + aliases + their own records. Redirect
# hosts must be aliases too — CloudFront rejects an unknown Host before the edge function sees
# it. `canonical_host` is the 301 target, which is not always `custom_domain`: during an apex
# cutover the apex is added as an alias (leaving the existing records untouched) while already
# being the public-facing name.
locals {
  extra_hostnames = concat(var.custom_domain_aliases, var.redirect_hosts)
  all_hostnames   = concat([var.custom_domain], local.extra_hostnames)
  canonical_host  = var.canonical_host != "" ? var.canonical_host : var.custom_domain
}

resource "aws_s3_bucket_versioning" "spa" {
  bucket = aws_s3_bucket.spa.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "spa" {
  bucket = aws_s3_bucket.spa.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "spa" {
  bucket                  = aws_s3_bucket.spa.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "spa" {
  name                              = "${var.name}-oac"
  description                       = "OAC for ${var.name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Lambda@Edge bundle: edge.py (committed) + a per-environment config.json
# rendered from config.json.tmpl at apply time. Lambda@Edge does not support
# environment variables, so config (app list, default app, public prefixes)
# is baked into the zip; any change to it republishes a new Lambda version
# and rolls it through CloudFront. The edge does routing only — no auth.
data "archive_file" "edge" {
  type        = "zip"
  output_path = "${path.module}/edge/edge.zip"

  source {
    content  = file("${path.module}/edge/edge.py")
    filename = "edge.py"
  }

  source {
    content = templatefile("${path.module}/edge/config.json.tmpl", {
      apps                 = var.apps
      static_apps          = var.static_apps
      default_app          = var.default_app
      public_path_prefixes = ["/documents/", "/pub/"]
      canonical_host       = local.canonical_host
      redirect_hosts       = var.redirect_hosts
    })
    filename = "config.json"
  }
}

# Lambda@Edge requires the trust policy to include both lambda.amazonaws.com
# (for execution) and edgelambda.amazonaws.com (for the replication service).
# Missing edgelambda.amazonaws.com results in cryptic "InvalidParameterValue"
# errors when CloudFront tries to associate the function.
data "aws_iam_policy_document" "edge_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "edge" {
  name               = "${var.name}-edge"
  assume_role_policy = data.aws_iam_policy_document.edge_trust.json
}

resource "aws_iam_role_policy_attachment" "edge_basic" {
  role       = aws_iam_role.edge.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Lambda@Edge functions MUST live in us-east-1 regardless of where the rest
# of the project is deployed. CloudFront then replicates them to every edge
# location automatically. The us_east_1 provider alias is declared in
# root.hcl's generate "providers" block.
#
# Operational gotchas:
#   - Once associated with a distribution, this function CANNOT be deleted
#     until AWS cleans up the replicas (~1 hour after detaching). Plan a
#     two-step teardown: detach -> wait -> destroy.
#   - publish = true is required; lambda_function_association needs a
#     versioned ARN (qualified_arn).
#   - viewer-request limits: 5s timeout, 128 MB memory, 1 MB code size.
#   - Logs land in /aws/lambda/us-east-1.<function-name> in whichever edge
#     region served the request, not in the function's home region.
resource "aws_lambda_function" "edge" {
  provider         = aws.us_east_1
  function_name    = "${var.name}-edge"
  role             = aws_iam_role.edge.arn
  handler          = "edge.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.edge.output_path
  source_code_hash = data.archive_file.edge.output_base64sha256
  publish          = true
  timeout          = 5
  memory_size      = 128
}

# Security response headers (HSTS, frame-options, XSS, referrer, CSP). The CSP
# is self-only by default and grows automatically when app_sync_domain is
# populated, so we don't need separate domain inputs to carry origins into
# it. `unsafe-inline` / `unsafe-eval` on script-src match the user's prior
# CSP and accommodate Vite-style bundles; tighten with nonces/hashes once
# the SPA's inline footprint is known.
#
# csp_auth_urls carries the Cognito issuer + hosted-UI origins so the OIDC
# client can fetch discovery metadata / tokens (connect-src) and run silent
# renew (frame-src). Google domains stay allowed for the federated leg.
locals {
  csp_img_src_values = distinct(concat(
    ["'self'", "data:", "blob:", "https://*.googleusercontent.com"],
    [for u in var.csp_extra_img_src_urls : trimsuffix(trimspace(u), "/")]
  ))
  csp_img_src_directive = "img-src ${join(" ", local.csp_img_src_values)}"

  csp_directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "script-src-attr 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    local.csp_img_src_directive,
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self'",
    join(" ", concat(
      ["connect-src 'self'", "https://accounts.google.com", "https://oauth2.googleapis.com"],
      var.app_sync_domain != "" ? ["https://${var.app_sync_domain}", "wss://${var.app_sync_domain}"] : [],
      [for u in var.csp_extra_connect_src_urls : trimsuffix(trimspace(u), "/")],
      [for u in var.csp_auth_urls : trimsuffix(trimspace(u), "/")]
    )),
    "worker-src 'self' blob:",
    join(" ", concat(
      ["frame-src 'self'", "https://accounts.google.com"],
      [for u in var.csp_extra_frame_src_urls : trimsuffix(trimspace(u), "/")],
      [for u in var.csp_auth_urls : trimsuffix(trimspace(u), "/")]
    )),
    "frame-ancestors 'self'",
    "form-action 'self' https://accounts.google.com",
    "manifest-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    "block-all-mixed-content"
  ]
}

resource "aws_cloudfront_response_headers_policy" "spa" {
  name = "${var.name}-headers"

  security_headers_config {
    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }

    content_security_policy {
      override                = true
      content_security_policy = join("; ", local.csp_directives)
    }

    xss_protection {
      protection = true
      mode_block = true
      override   = true
    }

    referrer_policy {
      referrer_policy = "same-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
  }
}

# --------------------------------------------------------------------------
# Custom domain: ACM cert in us-east-1 (CloudFront requirement) + DNS
# validation + A/AAAA alias records. Skipped when var.custom_domain is "".
#
# Cert is `create_before_destroy` so a domain rename produces a new cert
# alongside the old, validates it, then swaps the distribution's alias —
# avoids a window where the CloudFront alias is set but the cert isn't
# valid yet (which would cause TLS handshake failures for live users).
# --------------------------------------------------------------------------
resource "aws_acm_certificate" "custom_domain" {
  count                     = var.custom_domain == "" ? 0 : 1
  provider                  = aws.us_east_1
  domain_name               = var.custom_domain
  subject_alternative_names = local.extra_hostnames
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
    precondition {
      condition     = var.route53_zone_id != ""
      error_message = "var.custom_domain is set but var.route53_zone_id is empty; both must be set together."
    }
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.custom_domain == "" ? {} : {
    for dvo in aws_acm_certificate.custom_domain[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "custom_domain" {
  count                   = var.custom_domain == "" ? 0 : 1
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.custom_domain[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "alias_a" {
  count   = var.custom_domain == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.custom_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.spa.domain_name
    zone_id                = aws_cloudfront_distribution.spa.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  count   = var.custom_domain == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.custom_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.spa.domain_name
    zone_id                = aws_cloudfront_distribution.spa.hosted_zone_id
    evaluate_target_health = false
  }
}

# Extra hostnames get their own for_each resources rather than re-keying the two above:
# `name` is ForceNew, so folding the primary into a for_each would destroy and recreate every
# env's live A record — including the one Cognito's custom auth domain requires to exist.
resource "aws_route53_record" "alias_extra_a" {
  for_each        = var.custom_domain == "" ? toset([]) : toset(local.extra_hostnames)
  zone_id         = var.route53_zone_id
  name            = each.value
  type            = "A"
  allow_overwrite = var.allow_record_overwrite

  alias {
    name                   = aws_cloudfront_distribution.spa.domain_name
    zone_id                = aws_cloudfront_distribution.spa.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_extra_aaaa" {
  for_each        = var.custom_domain == "" ? toset([]) : toset(local.extra_hostnames)
  zone_id         = var.route53_zone_id
  name            = each.value
  type            = "AAAA"
  allow_overwrite = var.allow_record_overwrite

  alias {
    name                   = aws_cloudfront_distribution.spa.domain_name
    zone_id                = aws_cloudfront_distribution.spa.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_cloudfront_distribution" "spa" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.name
  default_root_object = var.default_root
  price_class         = var.price_class

  # Empty list when no custom domain is set; CloudFront falls back to its
  # *.cloudfront.net hostname for both the URL and the cert.
  aliases = var.custom_domain == "" ? [] : local.all_hostnames

  origin {
    origin_id                = "spa-bucket"
    domain_name              = aws_s3_bucket.spa.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.spa.id
  }

  # API origin for /auth/* and /api/*. Conditional on
  # api_origin_domain — when empty, no origin is added and the
  # ordered_cache_behaviors below are also skipped so those paths
  # fall through to S3 (which 404s — fine while the api stack hasn't
  # been applied yet).
  dynamic "origin" {
    for_each = var.api_origin_domain == "" ? [] : [1]
    content {
      origin_id   = "api-gateway"
      domain_name = var.api_origin_domain
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  # Streaming Glean-draft origin for /glean-api/* (the regional REST API in
  # STREAM mode). origin_path carries the stage so /glean-api/draft reaches
  # /<stage>/glean-api/draft. The read timeout stays at CloudFront's 30s
  # default: ~10s heartbeats from the streamer reset the inter-packet timer,
  # and the total-duration cap is left unset, so the effective ceiling is the
  # 15-min Lambda/REST STREAM limit. Conditional on the origin domain — empty
  # until the glean-stream stack is applied.
  dynamic "origin" {
    for_each = var.glean_stream_origin_domain == "" ? [] : [1]
    content {
      origin_id   = "glean-stream"
      domain_name = var.glean_stream_origin_domain
      origin_path = var.glean_stream_origin_path
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    target_origin_id       = "spa-bucket"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Managed-CachingOptimized
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id

    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.edge.qualified_arn
      include_body = false
    }
  }

  # /api/* -> API Gateway. Caching disabled; all headers/qs forwarded so the
  # JWT authorizer sees the Authorization header. Per-route auth is enforced
  # at the API Gateway JWT authorizer (openapi.spec.yml `security`); the edge
  # doesn't gate. (No /auth/* behavior anymore — Cognito owns the OAuth dance.)
  #
  # Managed cache policies used here:
  #   - CachingDisabled               4135ea2d-6df8-44a3-9df3-4b5a84be39ad
  #   - AllViewerExceptHostHeader     b689b0a8-53d0-40ab-baf2-68738e2966ac
  #
  # Why /api/* prefix rather than per-route behaviors: scales without
  # CloudFront edits as new endpoints land. Adding a route is one YAML
  # edit + one Python function; CloudFront stays static.
  dynamic "ordered_cache_behavior" {
    for_each = var.api_origin_domain == "" ? [] : [1]
    content {
      path_pattern             = "/api/*"
      target_origin_id         = "api-gateway"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = true
      cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
      origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    }
  }

  # /glean-api/* -> streaming REST API. compress MUST be false: CloudFront
  # compression buffers the response, which would defeat SSE streaming and
  # heartbeats. Same auth model as /api/* — AllViewerExceptHostHeader forwards
  # the Authorization bearer to the gateway's Cognito authorizer; caching
  # disabled. The edge function is NOT associated (ordered behaviors don't
  # inherit the default's), so streamed API calls skip SPA routing logic.
  dynamic "ordered_cache_behavior" {
    for_each = var.glean_stream_origin_domain == "" ? [] : [1]
    content {
      path_pattern             = "/glean-api/*"
      target_origin_id         = "glean-stream"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = false
      cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
      origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    }
  }

  # No /logos/* ordered_cache_behavior. Logos live as `logos/<sha>.<ext>`
  # KEYS inside the SPA bucket — the default behavior already serves them
  # from the SPA origin, and the edge function gates them via
  # gated_path_prefixes (see edge.py). Single bucket, single origin, single
  # bucket policy.

  # Per-app SPA fallback is handled at the edge (edge.py): requests under
  # /<app>/<route> with no static extension are rewritten to /<app>/index.html
  # before the origin fetch. CloudFront's custom_error_response only supports
  # a single global path, so it can't do per-app fallback — and there's no
  # /index.html at the bucket root in this layout to fall back to.

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # When custom_domain is empty, fall back to CloudFront's default
    # *.cloudfront.net cert. Otherwise reference the validated ACM cert
    # in us-east-1 — using the validation resource (not the cert directly)
    # so the distribution waits for DNS validation to complete.
    cloudfront_default_certificate = var.custom_domain == ""
    acm_certificate_arn            = var.custom_domain == "" ? null : aws_acm_certificate_validation.custom_domain[0].certificate_arn
    ssl_support_method             = var.custom_domain == "" ? null : "sni-only"
    minimum_protocol_version       = var.custom_domain == "" ? null : "TLSv1.2_2021"
  }
}

# Bucket policy: only this CloudFront distribution may GetObject.
data "aws_iam_policy_document" "spa" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.spa.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.spa.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "spa" {
  bucket = aws_s3_bucket.spa.id
  policy = data.aws_iam_policy_document.spa.json
}

