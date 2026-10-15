variable "name" {
  type        = string
  description = "Bucket name and CloudFront comment. Globally unique."
}

variable "default_root" {
  type    = string
  default = "index.html"
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

# Auth is no longer enforced at the edge — Cognito (AppSync OIDC + the HTTP
# API JWT authorizer) is the boundary, verifying tokens against the pool's
# JWKS. The edge only routes; the static shell is served openly.

variable "api_origin_domain" {
  type        = string
  default     = ""
  description = "Hostname (no scheme, no path) of the API Gateway endpoint that handles /api/*. When empty, no API origin is added and /api/* falls through to S3 (which 404s)."
}

variable "glean_stream_origin_domain" {
  type        = string
  default     = ""
  description = "Hostname (no scheme, no path) of the regional REST API that streams Glean drafts, fronted same-origin at /glean-api/*. When empty, no origin/behavior is added and /glean-api/* falls through to S3 (404s)."
}

variable "glean_stream_origin_path" {
  type        = string
  default     = ""
  description = "Origin path prepended to /glean-api/* requests — the REST API stage, e.g. /live (no trailing slash). So /glean-api/draft reaches /<stage>/glean-api/draft."
}

variable "app_sync_domain" {
  type    = string
  default = ""
}

variable "csp_auth_urls" {
  type        = list(string)
  default     = []
  description = "Cognito issuer + hosted-UI origins added to CSP connect-src and frame-src so the OIDC client can fetch metadata/tokens and run silent renew."
}

variable "csp_extra_img_src_urls" {
  type        = list(string)
  default     = []
  description = "Extra CSP img-src origins (scheme + host, optional trailing slash trimmed). Baseline always includes 'self', data:, blob:, and https://*.googleusercontent.com."
}

variable "csp_extra_connect_src_urls" {
  type        = list(string)
  default     = []
  description = "Extra CSP connect-src origins (scheme + host). For browser fetch/XHR targets beyond the API + auth + AppSync baselines — e.g. the S3 uploads bucket the Account Mapping page PUTs presigned files to."
}

variable "csp_extra_frame_src_urls" {
  type        = list(string)
  default     = []
  description = "Extra CSP frame-src origins (scheme + host) beyond the 'self' + Google + Cognito baseline. For pages that embed a third-party iframe — e.g. the developer portal's Apollo Sandbox, whose client iframe is served from https://sandbox.embed.apollographql.com. Empty when no app embeds a cross-origin iframe."
}

# Multi-app layout. Each app is built into its own S3 prefix
# (s3://bucket/<app>/index.html, s3://bucket/<app>/assets/...). The
# Lambda@Edge handler redirects "/" to /<default_app>/, and rewrites SPA
# routes under /<app>/<route> to /<app>/index.html so each app gets its
# own SPA fallback (CloudFront's custom_error_response only supports a
# single global path, which doesn't work in a multi-app layout).
variable "apps" {
  type        = list(string)
  default     = []
  description = "App prefixes mounted under the bucket. Each entry corresponds to an apps/<name>/ source tree deployed to s3://bucket/<name>/."
}

variable "static_apps" {
  type        = list(string)
  default     = []
  description = "Subset of `apps` served as multi-page static sites (e.g. a Docusaurus build) rather than SPAs. For these the edge resolves real per-route objects (`<route>/index.html`, `.html` pass-through) instead of the SPA fallback to /<app>/index.html, which would clobber the real pages. Default [] = every app keeps SPA behavior. Entries should also appear in `apps`."
}

variable "default_app" {
  type        = string
  default     = ""
  description = "Which app `/` should redirect to. Must be one of `apps`. Empty disables the redirect."
}

# Custom domain wiring. When BOTH `custom_domain` and `route53_zone_id`
# are set, the module:
#   - Provisions an ACM cert in us-east-1 (CloudFront requirement)
#   - Adds DNS validation records in the named Route53 zone
#   - Adds A + AAAA alias records pointing the FQDN at this distribution
#   - Sets `aliases` + `viewer_certificate.acm_certificate_arn` on the
#     CloudFront distribution
# When either is empty, the distribution stays on the default
# *.cloudfront.net hostname (no Route53 / ACM resources created).
variable "custom_domain" {
  type        = string
  default     = ""
  description = "FQDN to point at this distribution, e.g. example.<domain_root>. Must be a record `<sub>` whose parent zone is identified by route53_zone_id. Empty = use CloudFront's default *.cloudfront.net hostname (no ACM/Route53 wiring)."
}

variable "route53_zone_id" {
  type        = string
  default     = ""
  description = "ID of the Route53 hosted zone that owns the parent of `custom_domain`. Required when `custom_domain` is set; ignored otherwise."
}

# Additional hostnames on the same distribution. Both lists join `custom_domain` in the ACM
# cert SANs, the CloudFront aliases, and the Route53 alias records — a redirect host still
# needs to be an alias, or CloudFront rejects the Host before the edge function can 301 it.
variable "custom_domain_aliases" {
  type        = list(string)
  default     = []
  description = "Extra FQDNs served by this distribution alongside `custom_domain`, e.g. keeping a previous hostname alive after a cutover. Same zone as route53_zone_id."
}

variable "redirect_hosts" {
  type        = list(string)
  default     = []
  description = "FQDNs that 301 to `canonical_host` instead of serving, e.g. www.<domain_root>. Same zone as route53_zone_id."
}

variable "canonical_host" {
  type        = string
  default     = ""
  description = "Public-facing hostname the redirect_hosts 301 to. Defaults to `custom_domain`; set it explicitly when the public name is an entry in custom_domain_aliases instead (an apex cutover that leaves the existing primary records untouched)."
}

variable "allow_record_overwrite" {
  type        = bool
  default     = false
  description = "Let the alias records take over an existing RRSet instead of failing with `RRSet already exists`. Only needed when adopting a hostname that already has a hand-created record (e.g. an apex previously pointed elsewhere)."
}

