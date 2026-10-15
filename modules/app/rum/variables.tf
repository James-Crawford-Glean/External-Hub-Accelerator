variable "name" {
  type        = string
  description = "RUM app monitor + resource name prefix, e.g. <project>-rum-<env>."
}

variable "domains" {
  type        = list(string)
  description = "Hostnames the SPA is served from, e.g. [\"example.<domain_root>\"]. RUM rejects events from any other origin, server-side and silently. Bare hosts, no scheme; a leading `*.` wildcard is allowed. Max 5 (an AWS limit)."

  validation {
    condition     = length(var.domains) >= 1 && length(var.domains) <= 5
    error_message = "domains must hold between 1 and 5 hostnames."
  }
}

variable "session_sample_rate" {
  type        = number
  default     = 1
  description = "Fraction of sessions recorded (0-1). 1 = all; internal app volume is low."

  validation {
    condition     = var.session_sample_rate >= 0 && var.session_sample_rate <= 1
    error_message = "session_sample_rate must be between 0 and 1."
  }
}

variable "telemetries" {
  type        = list(string)
  default     = ["errors", "performance", "http"]
  description = "RUM auto-telemetry: http = request timing, errors = JS errors, performance = web vitals/page load."
}
