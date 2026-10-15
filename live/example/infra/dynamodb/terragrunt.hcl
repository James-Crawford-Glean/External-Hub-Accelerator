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

# Platform tables every portal needs regardless of domain. Domain tables
# (your entities, caches of upstream systems, event logs) are added to this
# same map; the module creates one table per key, named <prefix>-<key>.
#
# Every native PK is an opaque id (usr_<random>, apk_<random>, ...), never an
# upstream system's id. Upstream ids live as attributes + GSIs for lookup.
inputs = {
  name_prefix = "${local.project}-${local.env}"

  tables = {
    # Portal users: who has authenticated. Resolved on every authed request
    # from the Cognito `sub` claim, so that index is the hot path.
    users = {
      hash_key = "id"
      attributes = [
        { name = "id", type = "S" },
        { name = "google_sub", type = "S" },
        { name = "email", type = "S" },
      ]
      global_secondary_indexes = [
        { name = "google-sub-index", hash_key = "google_sub" },
        { name = "email-index", hash_key = "email" },
      ]
      pitr_enabled = true
    }

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

    # Append-only log of scheduled job runs (one row per run, newest first).
    sync_runs = {
      hash_key  = "sync_type"
      range_key = "ts_id"
      attributes = [
        { name = "sync_type", type = "S" },
        { name = "ts_id", type = "S" },
      ]
      pitr_enabled = false
    }
  }
}
