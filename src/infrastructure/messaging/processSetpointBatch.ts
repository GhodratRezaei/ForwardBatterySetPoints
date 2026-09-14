import {
  decodeServiceBusMessage,
  parseIncomingSetpoint,
} from "./setpointMessageMapper";
import { describeHttpError } from "../http/batteredBatteriesClient";
import { ForwardBatterySetpoint } from "../../application/use-cases/forwardBatterySetpoint";
import { SetpointPublisher } from "../../application/ports/setpointPublisher";
import { Logger } from "../../application/ports/logger";

export async function processSetpointBatch(
  rawMessages: unknown[],
  client: SetpointPublisher,
  context: Logger,
): Promise<void> {
  const forward = new ForwardBatterySetpoint(client);
  context.log(`Received a batch containing ${rawMessages.length} message(s).`);

  // The queue uses one session per device. Awaiting each call preserves the
  // session's received order and limits this invocation to one API call at a time.
  for (const [batchIndex, rawMessage] of rawMessages.entries()) {
    try {
      const decodedMessage = decodeServiceBusMessage(rawMessage);
      const deviceId = readDeviceId(decodedMessage);

      if (deviceId !== undefined && !forward.acceptsDevice(deviceId)) {
        // We interpret "abandon unknown devices" as discard/ignore. Throwing here
        // would make the same permanently unknown ID retry until dead-lettered.
        context.warn(
          `Skipping message ${batchIndex + 1}: device '${deviceId}' is not accepted.`,
        );
        continue;
      }

      const incomingSetpoint = parseIncomingSetpoint(decodedMessage);
      const preparedSetpoint = await forward.execute(incomingSetpoint);

      context.log(
        `Forwarded message ${batchIndex + 1} for device '${preparedSetpoint.deviceId}'.`,
      );
    } catch (error: unknown) {
      context.error(
        `Message ${batchIndex + 1} failed: ${describeHttpError(error)}`,
      );

      // With automatic Service Bus settlement, throwing causes the batch to be
      // retried. Service Bus eventually dead-letters repeatedly failing messages.
      // Do not pass Axios config/headers (including the vendor key) to host logs.
      throw new Error(describeHttpError(error));
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
