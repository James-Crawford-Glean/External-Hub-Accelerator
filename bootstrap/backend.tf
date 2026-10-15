# Partial config — actual values supplied at init time via -backend-config=backend.hcl.
# bootstrap.sh moves this file aside during phase 1 (initial bucket creation on
# local state) and restores it for phase 2 (state migration into the bucket).
terraform {
  backend "s3" {}
}
