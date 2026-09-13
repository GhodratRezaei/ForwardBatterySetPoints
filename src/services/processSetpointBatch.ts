import { InvocationContext } from "@azure/functions";
import {
  decodeServiceBusMessage,
  isAcceptedDeviceId,
  parseIncomingSetpoint,
  prepareSetpoint,
} from "../domain/setpoint";
import {
  BatteredBatteriesClient,
  describeHttpError,
} from "./batteredBatteriesClient";

export async function processSetpointBatch(
  rawMessages: unknown[],
  client: BatteredBatteriesClient,
  context: InvocationContext,
): Promise<void> {
  context.log(`Received a batch containing ${rawMessages.length} message(s).`);

  // The queue uses one session per device. Awaiting each call preserves the
  // session's received order and limits this invocation to one API call at a time.
  for (const [batchIndex, rawMessage] of rawMessages.entries()) {
    try {
      const decodedMessage = decodeServiceBusMessage(rawMessage);
      const deviceId = readDeviceId(decodedMessage);

      if (deviceId !== undefined && !isAcceptedDeviceId(deviceId)) {
        // We interpret "abandon unknown devices" as discard/ignore. Throwing here
        // would make the same permanently unknown ID retry until dead-lettered.
        context.warn(
          `Skipping message ${batchIndex + 1}: device '${deviceId}' is not accepted.`,
        );
        continue;
      }

      const incomingSetpoint = parseIncomingSetpoint(decodedMessage);
      const preparedSetpoint = prepareSetpoint(incomingSetpoint);

      await client.publishSetpoint(preparedSetpoint);

      context.log(
        `Forwarded message ${batchIndex + 1} for device '${preparedSetpoint.deviceId}'.`,
      );
    } catch (error: unknown) {
      context.error(
        `Message ${batchIndex + 1} failed: ${describeHttpError(error)}`,
      );

      // With automatic Service Bus settlement, throwing causes the batch to be
      // retried. Service Bus eventually dead-letters repeatedly failing messages.
      throw error;
    }
  }
}

function readDeviceId(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return undefined;
  }

  const deviceId = (message as Record<string, unknown>).device_id;
  return typeof deviceId === "string" ? deviceId : undefined;
}
