# DynamoDB tables provisioned dynamically from var.tables.
# Adding a table = add an entry to the map; no module edits.
#
# Two table shapes covered:
#   1. SF projection caches (sf_accounts/sf_opportunities/sf_user_directory/
#      enrichment_cache) — PK=id, SK=facet, TTL=expires_at. Read-through
#      via lib/cache.py with stale-while-revalidate.
#   2. Append-only event logs (partner_activities/sync_runs/
#      data_quality_flags) — PK=<entity>, SK=ts_id (iso ts + uuid).
#      Optional TTL on flag dismissal cleanup.

resource "aws_dynamodb_table" "this" {
  for_each = var.tables

  name         = "${var.name_prefix}-${each.key}"
  billing_mode = each.value.billing_mode
  hash_key     = each.value.hash_key
  range_key    = each.value.range_key

  dynamic "attribute" {
    for_each = each.value.attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  dynamic "global_secondary_index" {
    for_each = each.value.global_secondary_indexes
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash_key
      range_key       = global_secondary_index.value.range_key
      projection_type = global_secondary_index.value.projection_type
    }
  }

  dynamic "ttl" {
    for_each = each.value.ttl_attribute != null ? [each.value.ttl_attribute] : []
    content {
      attribute_name = ttl.value
      enabled        = true
    }
  }

  point_in_time_recovery {
    enabled = each.value.pitr_enabled
  }

  tags = var.tags
}
