variable "project" {
  type        = string
  description = "Project slug; prefixes resource names and the Project tag."
}

variable "name" {
  type        = string
  description = "Stack name prefix used for tags and the DB subnet group (e.g. <project>-network-<env>)."
}

variable "env" {
  type        = string
  description = "Environment slug (dev/staging/prod)."
}

variable "cidr" {
  type        = string
  default     = "10.20.0.0/16"
  description = "VPC CIDR. /16 leaves room for many /24 subnets across AZs and tiers."
}

variable "azs" {
  type        = list(string)
  default     = ["us-east-2a", "us-east-2b"]
  description = "AZs to deploy into. Must be >=2 for Aurora subnet groups. NAT (when enabled) lives in the FIRST entry only."
}

variable "enable_nat_gateway" {
  type        = bool
  default     = false
  description = "Provision a NAT gateway + private-subnet default route. Off by default: every Lambda reaches Aurora over the Data API and runs outside the VPC. Flip on only if a VPC-attached workload needs outbound internet."
}

variable "enable_interface_endpoints" {
  type        = bool
  default     = false
  description = "Provision Secrets Manager + KMS interface endpoints (billed per ENI-hour per AZ). Off by default: they only serve VPC-attached lambdas fetching secrets/keys, and the sole VPC-attached lambda (api) fetches none. Flip on when a VPC-attached workload needs private AWS API access without a NAT. The free S3 gateway endpoint is unaffected."
}
