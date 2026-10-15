#!/usr/bin/env bash
# Fails if anything environment-specific or secret-shaped is committed.
# Run from the repo root; CI runs it on every PR.
#
# Allowed: AWS's all-zero mock account (000000000000) in Terragrunt
# mock_outputs, and the GitHub OIDC thumbprint (a published constant).

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required: brew install ripgrep / apt install ripgrep" >&2
  exit 2
fi

fail=0
check() {
  local label="$1" pattern="$2"
  shift 2
  if hits=$(rg -n --hidden --glob '!.git' --glob '!node_modules' --glob '!**/pnpm-lock.yaml' \
      --glob '!**/package-lock.json' --glob '!scripts/check-sanitized.sh' "$@" "$pattern" .); then
    echo "FAIL [$label]"
    echo "$hits"
    fail=1
  fi
}

# Real AWS account ids (anything that isn't the mock account).
check "aws account id" '\b(?!000000000000)[0-9]{12}\b' --pcre2
# Route53 zone ids.
check "route53 zone id" '\bZ[0-9A-Z]{13,32}\b'
# Credentials and tokens.
check "aws access key" '\bAKIA[0-9A-Z]{16}\b'
check "private key" 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
check "jwt" '\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'
check "slack token" '\bxox[abprs]-[0-9A-Za-z-]{10,}\b'
check "stripe-style key" '\b[sp]k_(live|test)_[0-9A-Za-z]{10,}\b'
# Salesforce record ids (15 or 18 chars, known key prefixes).
check "salesforce id" '\b(001|003|005|006|00Q|00D|00e|0014)[0-9A-Za-z]{11}([0-9A-Za-z]{3})?\b'
# Email addresses other than documented placeholders.
check "email address" '\b[A-Za-z0-9._%+-]+@(?!example\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b' --pcre2
# Hostnames that belong to the source project rather than the adopter. Glean
# tenant backends are <tenant>-be.glean.com; only a concrete tenant is flagged.
check "source-project hostname" '\b[a-z0-9.-]*(partnersync\.io|gleandemo\.com)\b'
check "glean tenant hostname" '\b[a-z0-9-]+-be\.glean\.com\b'
# README.md may name the source project once, for provenance.
check "source-project name" '(?i)partnersync|askscio' --pcre2 --glob '!README.md'

if [[ $fail -ne 0 ]]; then
  echo
  echo "Sanitization check failed. Replace the value with a placeholder or an environment variable."
  exit 1
fi
echo "sanitized: ok"
