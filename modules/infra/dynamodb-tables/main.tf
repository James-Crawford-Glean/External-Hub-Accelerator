# DynamoDB tables provisioned dynamically from var.tables.
# Adding a table = add an entry to the map; no module edits.
#
# Shapes this fits: key-value credential stores (PK=id + a hash GSI),
# read-through caches of upstream systems (PK=id, SK=facet, TTL=expires_at),
# and append-only event logs (PK=<entity>, SK=ts_id).

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
