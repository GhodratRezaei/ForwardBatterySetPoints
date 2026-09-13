import { app, InvocationContext } from "@azure/functions";
import {
  FUNCTION_NAME,
  loadAppConfig,
  SERVICE_BUS_CONNECTION_SETTING,
  SERVICE_BUS_QUEUE_NAME,
} from "../config";
import { BatteredBatteriesClient } from "../services/batteredBatteriesClient";
import { processSetpointBatch } from "../services/processSetpointBatch";

export async function forwardBatterySetpoints(
  messages: unknown[],
  context: InvocationContext,
): Promise<void> {
  const config = loadAppConfig();
  const client = new BatteredBatteriesClient({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
  });

  await processSetpointBatch(messages, client, context);
}

app.serviceBusQueue(FUNCTION_NAME, {
  queueName: SERVICE_BUS_QUEUE_NAME,
  connection: SERVICE_BUS_CONNECTION_SETTING,
  // Assumption: the queue is session-enabled and the sender uses device_id
  // as the Service Bus SessionId, preserving order for each battery.
  isSessionsEnabled: true,
  cardinality: "many",
  autoCompleteMessages: true,
  handler: forwardBatterySetpoints,
});
