#!/usr/bin/env bash
# Two-phase bootstrap:
#   1. If the state bucket does not yet exist, run with LOCAL state to create it
#      (the S3 backend declaration in backend.tf is temporarily moved aside so
#      Terraform doesn't demand a configured backend during phase 1).
#   2. Restore backend.tf and re-init with -migrate-state so the bootstrap's own
#      state lives in the bucket it just created.
#
# Idempotent. Safe to re-run; subsequent runs detect the bucket and initialise
# straight against the remote backend.
#
# Usage:
#   PROJECT=<project> ./bootstrap.sh <AWS_ACCOUNT_ID> [<AWS_REGION>]
#
# PROJECT must equal `project` in ../root.hcl; the live/ stacks derive the
# bucket name from that value.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: PROJECT=<project> $0 <AWS_ACCOUNT_ID> [<AWS_REGION>]" >&2
  exit 1
fi

PROJECT="${PROJECT:-portal}"
ACCOUNT_ID="$1"
REGION="${2:-us-east-2}"
BUCKET="${PROJECT}-tf-state-${ACCOUNT_ID}"

cd "$(dirname "$0")"

# Per-account backend config; not committed.
cat > backend.hcl <<HCL
bucket       = "${BUCKET}"
key          = "bootstrap/terraform.tfstate"
region       = "${REGION}"
use_lockfile = true
encrypt      = true
HCL

TF_VARS=(-var="project=${PROJECT}" -var="aws_account_id=${ACCOUNT_ID}" -var="aws_region=${REGION}")

caller=$(aws sts get-caller-identity --output text --query Account 2>/dev/null || true)
if [[ -z "$caller" ]]; then
  echo "ERROR: AWS credentials not configured." >&2
  exit 1
fi
if [[ "$caller" != "$ACCOUNT_ID" ]]; then
  echo "ERROR: caller is account $caller but you asked to bootstrap $ACCOUNT_ID." >&2
  exit 1
fi

if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "[bootstrap] State bucket $BUCKET exists; using remote backend directly."
  [[ -f backend.tf ]] || mv backend.tf.disabled backend.tf
  terraform init -reconfigure -backend-config=backend.hcl
  terraform apply "${TF_VARS[@]}"
  echo "[bootstrap] Done. State is in s3://${BUCKET}/bootstrap/terraform.tfstate."
  exit 0
fi

echo "[bootstrap] State bucket does not exist."
echo "[bootstrap] Phase 1: temporarily disabling the S3 backend and applying on LOCAL state."

[[ -f backend.tf ]] && mv backend.tf backend.tf.disabled
rm -rf .terraform .terraform.lock.hcl

terraform init
terraform apply -auto-approve "${TF_VARS[@]}"

echo "[bootstrap] Phase 2: restoring backend.tf and migrating local state into s3://${BUCKET}/bootstrap/."
mv backend.tf.disabled backend.tf
terraform init -migrate-state -force-copy -backend-config=backend.hcl

echo "[bootstrap] Cleaning up local state files (state now lives in S3)."
rm -f terraform.tfstate terraform.tfstate.backup

echo "[bootstrap] Done."
echo "            Subsequent runs (this script, or 'terraform <cmd> -backend-config=backend.hcl')"
echo "            operate against the remote state."
