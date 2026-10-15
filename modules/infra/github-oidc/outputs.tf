output "role_arn" { value = aws_iam_role.spa_deploy.arn }
output "oidc_provider" { value = local.oidc_provider_arn }
