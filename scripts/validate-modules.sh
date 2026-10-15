#!/usr/bin/env bash
# `terraform validate` for every module in isolation. Terragrunt generates
# providers.tf at run time, so a throwaway provider file is dropped into each
# module for the duration of the check and removed afterwards.

set -u
cd "$(dirname "$0")/.."
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-/tmp/tf-plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"

rc=0
for m in $(find modules -mindepth 2 -maxdepth 2 -type d | sort); do
  cat > "$m/zz_validate_providers.tf" <<'TF'
terraform {
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.70" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}
provider "aws" { region = "us-east-2" }
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
TF
  out=$( (cd "$m" && terraform init -backend=false -input=false >/dev/null 2>&1 && terraform validate -no-color) 2>&1 )
  code=$?
  rm -f "$m/zz_validate_providers.tf"
  rm -rf "$m/.terraform" "$m/.terraform.lock.hcl"
  if [[ $code -eq 0 ]]; then
    echo "ok    $m"
  else
    echo "FAIL  $m"
    echo "$out" | sed 's/^/      /'
    rc=1
  fi
done
exit $rc
