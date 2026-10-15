output "cluster_arn" {
  value = aws_rds_cluster.this.arn
}

output "cluster_endpoint" {
  value = aws_rds_cluster.this.endpoint
}

output "cluster_reader_endpoint" {
  value = aws_rds_cluster.this.reader_endpoint
}

output "cluster_resource_id" {
  description = "Resource ID used in IAM auth ARNs: arn:aws:rds-db:<region>:<account>:dbuser:<resource-id>/<db-user>."
  value       = aws_rds_cluster.this.cluster_resource_id
}

output "database_name" {
  value = aws_rds_cluster.this.database_name
}

output "master_username" {
  value = aws_rds_cluster.this.master_username
}

output "cluster_security_group_id" {
  value = aws_security_group.cluster.id
}

output "master_password_secret_id" {
  description = "ARN of the RDS-managed Secrets Manager secret holding the master credentials. Used by the bootstrap script as the Data API auth source."
  value       = aws_rds_cluster.this.master_user_secret[0].secret_arn
}
