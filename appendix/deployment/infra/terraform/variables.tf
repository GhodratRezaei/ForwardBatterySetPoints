# Target subscription and resource naming.
variable "subscription_id" {
  type        = string
  description = "Target Azure subscription UUID. Authentication comes from CLI or federation."
}

variable "name_prefix" {
  type        = string
  description = "Globally unique lowercase prefix, 3-12 letters/digits; starts with a letter."
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{2,11}$", var.name_prefix))
    error_message = "Use 3-12 lowercase letters/digits, starting with a letter."
  }
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be dev or prod."
  }
}

# Azure location and vendor endpoint.
variable "location" {
  type    = string
  default = "westeurope"
}

variable "vendor_base_url" {
  type        = string
  description = "HTTPS mock endpoint in dev; authorized vendor endpoint in prod."
  validation {
    condition     = can(regex("^https://[^/?#]+", var.vendor_base_url))
    error_message = "Provide an HTTPS base URL."
  }
}

variable "enable_trigger" {
  type        = bool
  default     = false
  description = "Enable only after the vendor key, endpoint and queue contract are verified."
}

# Runtime readiness and operations.
variable "always_ready_instances" {
  type    = number
  default = 0
  validation {
    condition     = var.always_ready_instances >= 0 && var.always_ready_instances <= 2 && floor(var.always_ready_instances) == var.always_ready_instances
    error_message = "This example accepts 0, 1 or 2 always-ready instances."
  }
}

variable "alert_email" {
  type        = string
  description = "Team operational alert destination; set before deployment."
}

variable "tags" {
  type    = map(string)
  default = {}
}
