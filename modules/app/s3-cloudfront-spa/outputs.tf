output "bucket" { value = aws_s3_bucket.spa.id }
output "bucket_arn" { value = aws_s3_bucket.spa.arn }
output "distribution_id" { value = aws_cloudfront_distribution.spa.id }
output "distribution_arn" { value = aws_cloudfront_distribution.spa.arn }
output "distribution_url" { value = "https://${aws_cloudfront_distribution.spa.domain_name}" }

# Public URL the SPA is reachable at. When a custom domain is configured,
# this resolves to the FQDN; otherwise it's the CloudFront default. Other
# stacks (notably api's PUBLIC_BASE_URL) should consume this rather than
# hardcoding a hostname.
output "public_url" {
  value = var.custom_domain == "" ? "https://${aws_cloudfront_distribution.spa.domain_name}" : "https://${var.custom_domain}"
}
