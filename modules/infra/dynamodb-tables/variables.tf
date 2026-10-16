variable "name_prefix" {
  description = "Prefix for table names. e.g. '<project>-<env>' -> '<project>-<env>-api_keys'."
  type        = string
}

variable "tables" {
  description = "Map of logical name -> table config. Add an entry to provision a new table; no module changes needed."
  type = map(object({
    hash_key  = string
    range_key = optional(string)

    attributes = list(object({
      name = string
      type = string
    }))

    global_secondary_indexes = optional(list(object({
      name            = string
      hash_key        = string
      range_key       = optional(string)
      projection_type = optional(string, "ALL")
    })), [])

    ttl_attribute = optional(string)
    pitr_enabled  = optional(bool, false)
    billing_mode  = optional(string, "PAY_PER_REQUEST")
  }))
}

variable "tags" {
  type    = map(string)
  default = {}
}
