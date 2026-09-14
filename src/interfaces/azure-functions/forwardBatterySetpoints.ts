import { app, InvocationContext } from "@azure/functions";
import {
  FUNCTION_NAME,
  SERVICE_BUS_CONNECTION_SETTING,
  SERVICE_BUS_QUEUE_NAME,
} from "../../bootstrap/config";
import { getSetpointPublisher } from "../../bootstrap/container";
import { processSetpointBatch } from "../../infrastructure/messaging/processSetpointBatch";

export async function forwardBatterySetpoints(
  messages: unknown[],
  context: InvocationContext,
): Promise<void> {
  // The trigger adapter translates Azure invocations into application calls.
  const client = getSetpointPublisher();

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
