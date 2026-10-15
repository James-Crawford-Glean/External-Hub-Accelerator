output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  value = [for s in aws_subnet.public : s.id]
}

output "private_subnet_ids" {
  value = [for s in aws_subnet.private : s.id]
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.this.name
}

output "default_security_group_id" {
  description = "VPC default SG. Aurora and Lambda stacks should each create their OWN SGs and reference this one only when they specifically need 'all VPC traffic' rules."
  value       = aws_vpc.this.default_security_group_id
}
