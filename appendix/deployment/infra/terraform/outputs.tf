output "function_app_name" {
	value = azurerm_function_app_flex_consumption.forwarder.name
}

output "resource_group_name" {
	value = azurerm_resource_group.service.name
}

output "service_bus_namespace" {
	value = azurerm_servicebus_namespace.commands.name
}

output "queue_name" {
	value = azurerm_servicebus_queue.setpoints.name
}

output "key_vault_name" {
	value = azurerm_key_vault.vendor.name
}

output "application_insights_name" {
	value = azurerm_application_insights.service.name
}

output "function_identity_principal_id" {
	value = azurerm_function_app_flex_consumption.forwarder.identity[0].principal_id
}
