# Per-environment VPC: Aurora-ready, Lambda-ready, cost-optimized for non-prod.
#
# Topology (per environment):
#   - 1 VPC (default CIDR 10.20.0.0/16)
#   - 2 AZs — Aurora subnet groups require >=2 AZs
#   - 1 public /24 per AZ  (future ALB / bastion)
#   - 1 private /24 per AZ (Aurora, Lambdas)
#   - 1 IGW
#   - NAT gateway is OPTIONAL and OFF by default (var.enable_nat_gateway).
#     Nothing needs it by default: every Lambda reaches Aurora via the Data
#     API and runs outside the VPC. Flip on (and move to per-AZ NATs for prod)
#     only if a VPC-attached workload ever needs outbound internet.
#   - Interface VPC endpoints for Secrets Manager and KMS (avoids NAT $$ on
#     the highest-frequency Lambda calls)
#   - Gateway VPC endpoint for S3 (free; always worth it)
#   - One DB subnet group spanning both private subnets
#
# Resource-level perms in IAM are scoped to tag `Project=<project>` so the
# CI role can manage the VPC's children (subnets/route tables/etc.) without
# being granted account-wide ec2:* — see modules/github-oidc.

locals {
  # /24 subnets, two per AZ. Layout:
  #   public[i]  = 10.20.<i>.0/24       (i=0,1)
  #   private[i] = 10.20.<i+10>.0/24    (i=0,1)
  # The +10 offset leaves a clean numeric gap so future tiers (e.g. an
  # isolated DB-only tier, or a transit-gateway attachment subnet) can slot
  # in at /24 boundaries without renumbering.
  public_cidrs  = [for i, _ in var.azs : cidrsubnet(var.cidr, 8, i)]
  private_cidrs = [for i, _ in var.azs : cidrsubnet(var.cidr, 8, i + 10)]

  common_tags = {
    Project = var.project
    Env     = var.env
    Stack   = var.name
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${var.name}-igw" })
}

resource "aws_subnet" "public" {
  for_each = { for i, az in var.azs : az => { idx = i, cidr = local.public_cidrs[i] } }

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value.cidr
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${var.name}-public-${each.key}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  for_each = { for i, az in var.azs : az => { idx = i, cidr = local.private_cidrs[i] } }

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value.cidr

  tags = merge(local.common_tags, {
    Name = "${var.name}-private-${each.key}"
    Tier = "private"
  })
}

# NAT gateway — off by default (see var.enable_nat_gateway). When enabled it
# lands in the FIRST AZ's public subnet and both private subnets route through
# it. TODO(prod): if ever enabled for prod, switch to one NAT per AZ so a
# single-AZ outage can't isolate the surviving private subnet.
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? 1 : 0
  domain = "vpc"
  tags   = merge(local.common_tags, { Name = "${var.name}-nat-eip" })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count         = var.enable_nat_gateway ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[var.azs[0]].id

  tags = merge(local.common_tags, { Name = "${var.name}-nat" })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.common_tags, { Name = "${var.name}-public-rt" })
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  # Routes managed as standalone aws_route resources (below), not inline —
  # inline routes referencing a destroyed NAT don't diff cleanly and leave a
  # blackhole route. Standalone routes destroy explicitly and in order.
  tags = merge(local.common_tags, { Name = "${var.name}-private-rt" })
}

# Default egress route — exists only when the NAT does. Without it the private
# subnets are egress-free (correct: Aurora needs none, the Data API is reached
# from non-VPC lambdas). S3 still flows via the gateway endpoint's route.
resource "aws_route" "private_nat" {
  count                  = var.enable_nat_gateway ? 1 : 0
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# DB subnet group spanning both private subnets. Aurora consumes this by name
# via remote-state output from the network stack.
resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = [for s in aws_subnet.private : s.id]
  tags       = merge(local.common_tags, { Name = var.name })
}

# Gateway endpoint for S3. Free, route-table-attached, no ENI cost.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = merge(local.common_tags, { Name = "${var.name}-s3-endpoint" })
}

# Interface endpoints for Secrets Manager and KMS — off by default (see
# var.enable_interface_endpoints). Each ENI costs ~$0.01/hr per AZ; they only
# earn their keep for VPC-attached lambdas making frequent secret/KMS calls,
# and none exist today. Enable alongside a VPC-attached workload that needs
# private AWS API access (cheaper than routing it through a NAT).
resource "aws_security_group" "endpoints" {
  count       = var.enable_interface_endpoints ? 1 : 0
  name        = "${var.name}-endpoints"
  description = "Allow HTTPS from inside the VPC to interface VPC endpoints."
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.this.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${var.name}-endpoints-sg" })
}

resource "aws_vpc_endpoint" "secretsmanager" {
  count               = var.enable_interface_endpoints ? 1 : 0
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.name}-secretsmanager-endpoint" })
}

resource "aws_vpc_endpoint" "kms" {
  count               = var.enable_interface_endpoints ? 1 : 0
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.kms"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.name}-kms-endpoint" })
}

data "aws_region" "current" {}
