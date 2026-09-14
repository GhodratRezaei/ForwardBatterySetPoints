export const ACCEPTED_DEVICE_IDS = [
  "BB00001",
  "BB00005",
  "BB00006",
  "BB00007",
  "BB00293",
] as const;

export type AcceptedDeviceId = (typeof ACCEPTED_DEVICE_IDS)[number];

export interface SetpointCommand {
  readonly deviceId: string;
  readonly valueKilowatts: number;
  readonly eventTime: string;
  readonly endTime: string;
}

/**
 * Data that no longer depends on the vendor API clock.
 * The HTTP body is created immediately before each HTTP attempt so startTime
 * is still in the future if an earlier attempt had to be retried.
 */
export interface PreparedSetpoint {
  readonly deviceId: AcceptedDeviceId;
  readonly valueWatts: number;
  readonly durationSeconds: number;
}

export class InvalidSetpointError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidSetpointError";
  }
}

export function isAcceptedDeviceId(deviceId: string): deviceId is AcceptedDeviceId {
  return (ACCEPTED_DEVICE_IDS as readonly string[]).includes(deviceId);
}

export function prepareSetpoint(
  message: SetpointCommand,
): PreparedSetpoint {
  if (!isAcceptedDeviceId(message.deviceId)) {
    throw new InvalidSetpointError(
      `Device '${message.deviceId}' is not in the accepted-device list.`,
    );
  }

  if (
    !Number.isFinite(message.valueKilowatts) ||
    !Number.isSafeInteger(Math.round(message.valueKilowatts * -1000))
  ) {
    throw new InvalidSetpointError("Power must convert to a safe integer number of watts.");
  }

  const eventTimeMs = Date.parse(message.eventTime);
  const endTimeMs = Date.parse(message.endTime);

  if (!Number.isFinite(eventTimeMs) || !Number.isFinite(endTimeMs)) {
    throw new InvalidSetpointError("eventTime and endTime must be valid ISO dates.");
  }

  const durationMs = endTimeMs - eventTimeMs;
  const minimumDurationMs = 60 * 1_000;
  const maximumDurationMs = 60 * 60 * 1_000;

  if (durationMs < minimumDurationMs || durationMs > maximumDurationMs) {
    throw new InvalidSetpointError(
      "The setpoint duration must be between 1 minute and 1 hour.",
    );
  }

  return Object.freeze({
    deviceId: message.deviceId,
    // Incoming values use the grid perspective; the API uses the battery perspective.
    // The minus sign reverses the direction and 1000 converts kilowatts to watts.
    valueWatts: Math.round(message.valueKilowatts * -1_000),
    // The API accepts whole epoch seconds. Ceil avoids shortening the instruction.
    durationSeconds: Math.ceil(durationMs / 1_000),
  });
}

