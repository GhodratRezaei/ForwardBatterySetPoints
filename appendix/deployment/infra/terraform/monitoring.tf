# Shared notification target for platform alerts.
resource "azurerm_monitor_action_group" "operations" {
  name                = "alerts-${local.name}"
  resource_group_name = azurerm_resource_group.service.name
  short_name          = "battery"
  email_receiver {
    name          = "operations"
    email_address = var.alert_email
  }
  tags = local.tags
}

# Alert when commands enter the Service Bus dead-letter queue.
resource "azurerm_monitor_metric_alert" "dead_letters" {
  name                = "dlq-${local.name}"
  resource_group_name = azurerm_resource_group.service.name
  scopes              = [azurerm_servicebus_namespace.commands.id]
  description         = "Battery commands are in the dead-letter queue; investigate before replay."
  severity            = 1
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.ServiceBus/namespaces"
    metric_name      = "DeadletteredMessages"
    aggregation      = "Maximum"
    operator         = "GreaterThan"
    threshold        = 0
    dimension {
      name     = "EntityName"
      operator = "Include"
      values   = [azurerm_servicebus_queue.setpoints.name]
    }
  }
  action { action_group_id = azurerm_monitor_action_group.operations.id }
  tags = local.tags
}

# Alert when the Function reports failed requests.
resource "azurerm_monitor_metric_alert" "failed_invocations" {
  name                = "failures-${local.name}"
  resource_group_name = azurerm_resource_group.service.name
  scopes              = [azurerm_application_insights.service.id]
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.Insights/components"
    metric_name      = "requests/failed"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 0
  }
  action { action_group_id = azurerm_monitor_action_group.operations.id }
  tags = local.tags
}
