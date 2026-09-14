data "azurerm_client_config" "current" {}

locals {
  name = "${var.name_prefix}-${var.environment}"
  tags = merge(var.tags, { environment = var.environment, service = "battery-setpoint-forwarder", managed_by = "terraform" })
}

resource "azurerm_resource_group" "service" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "function" {
  name                            = "${var.name_prefix}${var.environment}func"
  resource_group_name             = azurerm_resource_group.service.name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  tags                            = local.tags
}

resource "azurerm_storage_container" "deployment" {
  name                  = "function-releases"
  storage_account_id    = azurerm_storage_account.function.id
  container_access_type = "private"
}

resource "azurerm_servicebus_namespace" "commands" {
  name                = "sb-${local.name}"
  location            = var.location
  resource_group_name = azurerm_resource_group.service.name
  sku                 = "Standard"
  local_auth_enabled  = false
  minimum_tls_version = "1.2"
  tags                = local.tags
}

resource "azurerm_servicebus_queue" "setpoints" {
  name                                 = "sbq-batbat-spt"
  namespace_id                         = azurerm_servicebus_namespace.commands.id
  requires_session                     = true
  lock_duration                        = "PT5M"
  max_delivery_count                   = 5
  dead_lettering_on_message_expiration = true
  # Expiry is a business decision. Do not silently invent a command TTL here.
}

resource "azurerm_key_vault" "vendor" {
  name                       = "kv-${local.name}"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.service.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  tags                       = local.tags
  # The secret value is supplied outside Terraform; it never enters state.
}

resource "azurerm_log_analytics_workspace" "service" {
  name                = "log-${local.name}"
  location            = var.location
  resource_group_name = azurerm_resource_group.service.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "service" {
  name                = "appi-${local.name}"
  location            = var.location
  resource_group_name = azurerm_resource_group.service.name
  workspace_id        = azurerm_log_analytics_workspace.service.id
  application_type    = "web"
  tags                = local.tags
}

resource "azurerm_service_plan" "function" {
  name                = "plan-${local.name}"
  location            = var.location
  resource_group_name = azurerm_resource_group.service.name
  os_type             = "Linux"
  sku_name            = "FC1"
  tags                = local.tags
}

resource "azurerm_function_app_flex_consumption" "forwarder" {
  name                                           = "func-${local.name}"
  location                                       = var.location
  resource_group_name                            = azurerm_resource_group.service.name
  service_plan_id                                = azurerm_service_plan.function.id
  storage_container_type                         = "blobContainer"
  storage_container_endpoint                     = "${azurerm_storage_account.function.primary_blob_endpoint}${azurerm_storage_container.deployment.name}"
  storage_authentication_type                    = "SystemAssignedIdentity"
  runtime_name                                   = "node"
  runtime_version                                = "24"
  maximum_instance_count                         = 40
  instance_memory_in_mb                          = 2048
  https_only                                     = true
  webdeploy_publish_basic_authentication_enabled = false
  tags                                           = local.tags

  identity { type = "SystemAssigned" }

  dynamic "always_ready" {
    for_each = var.always_ready_instances > 0 ? [1] : []
    content {
      name           = "function:forwardBatterySetpoints"
      instance_count = var.always_ready_instances
    }
  }

  site_config {
    application_insights_connection_string = azurerm_application_insights.service.connection_string
    minimum_tls_version                    = "1.2"
  }

  app_settings = {
    "AzureWebJobsStorage__accountName"              = azurerm_storage_account.function.name
    "AzureWebJobsStorage__credential"               = "managedidentity"
    "CONNECTION-STRING-SBQ-BATBAT-SPT__fullyQualifiedNamespace" = "${azurerm_servicebus_namespace.commands.name}.servicebus.windows.net"
    "CONNECTION-STRING-SBQ-BATBAT-SPT__credential"              = "managedidentity"
    "BATTERED_BATTERIES_BASE_URL"                   = var.vendor_base_url
    "BATTERED_BATTERIES_API_KEY"                    = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.vendor.vault_uri}secrets/vendor-api-key/)"
    "AzureWebJobs.forwardBatterySetpoints.Disabled" = tostring(!var.enable_trigger)
  }
  # Terraform owns configuration. CI/CD owns the application package via One Deploy.
}

resource "azurerm_role_assignment" "receive_commands" {
  scope                = azurerm_servicebus_queue.setpoints.id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = azurerm_function_app_flex_consumption.forwarder.identity[0].principal_id
}

resource "azurerm_role_assignment" "host_storage" {
  scope                = azurerm_storage_account.function.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azurerm_function_app_flex_consumption.forwarder.identity[0].principal_id
}

resource "azurerm_role_assignment" "vendor_key" {
  scope                = azurerm_key_vault.vendor.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_function_app_flex_consumption.forwarder.identity[0].principal_id
}
