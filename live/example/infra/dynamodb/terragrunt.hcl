include "root" {
  path   = find_in_parent_folders("root.hcl")
  expose = true
}

terraform {
  source = "../../../../modules/infra/dynamodb-tables"
}

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env      = local.env_vars.locals.env
  project  = include.root.locals.project
}

# DynamoDB holds what needs O(1) key lookups or TTL expiry: service
# credentials and the external-lookup cache. Relational data (users, roster,
# domain entities, run logs) lives in Aurora; see backend/migrations.
# Domain caches are added to this same map; the module creates one table per
# key, named <prefix>-<key>.
#
# Every native PK is an opaque id (apk_<random>, ...), never an upstream
# system's id. Upstream ids live as attributes + GSIs for lookup.
inputs = {
  name_prefix = "${local.project}-${local.env}"

  tables = {
    # Service credentials (opaque API keys). The raw secret is never stored,
    # only HMAC(pepper, token), looked up O(1) via hash-index. No TTL:
    # revoked and expired keys are retained for audit.
    api_keys = {
      hash_key = "id"
      attributes = [
        { name = "id", type = "S" },
        { name = "secret_hash", type = "S" },
      ]
      global_secondary_indexes = [
        { name = "hash-index", hash_key = "secret_hash" }
      ]
      pitr_enabled = true
    }

    # Read-through cache for external lookups (logos, website metadata),
    # keyed by entity id + facet. Rows carry a TTL; the loader refreshes
    # stale entries on read.
    enrichment_cache = {
      hash_key  = "id"
      range_key = "facet"
      attributes = [
        { name = "id", type = "S" },
        { name = "facet", type = "S" },
      ]
      ttl_attribute = "expires_at"
      pitr_enabled  = false
    }
  }
}
