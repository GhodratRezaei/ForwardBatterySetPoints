import { API_START_DELAY_SECONDS } from "../config";

export const ACCEPTED_DEVICE_IDS = [
  "BB00001",
  "BB00005",
  "BB00006",
  "BB00007",
  "BB00293",
] as const;

export type AcceptedDeviceId = (typeof ACCEPTED_DEVICE_IDS)[number];

export interface IncomingSetpointMessage {
  device_id: string;
  setpoint: {
    value: number;
    unit: "kW";
    endTime: string;
  };
  eventTime: string;
}

/**
 * Data that no longer depends on the vendor API clock.
 * The HTTP body is created immediately before each HTTP attempt so startTime
 * is still in the future if an earlier attempt had to be retried.
 */
export interface PreparedSetpoint {
  deviceId: AcceptedDeviceId;
  valueWatts: number;
  durationSeconds: number;
}

export interface BatteredBatteriesRequest {
  data: {
    startTime: number;
    endTime: number;
    value: number;
  };
}

export class InvalidSetpointError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidSetpointError";
  }
}

export function decodeServiceBusMessage(rawMessage: unknown): unknown {
  if (typeof rawMessage === "string") {
    try {
      return JSON.parse(rawMessage) as unknown;
    } catch {
      throw new InvalidSetpointError("The Service Bus message is not valid JSON.");
    }
  }

  if (Buffer.isBuffer(rawMessage)) {
    return decodeServiceBusMessage(rawMessage.toString("utf8"));
  }

  return rawMessage;
}

export function parseIncomingSetpoint(rawMessage: unknown): IncomingSetpointMessage {
  const value = decodeServiceBusMessage(rawMessage);

  if (!isRecord(value)) {
    throw new InvalidSetpointError("The Service Bus message must be a JSON object.");
  }

  if (typeof value.device_id !== "string" || value.device_id.trim() === "") {
    throw new InvalidSetpointError("device_id must be a non-empty string.");
  }

  if (!isRecord(value.setpoint)) {
    throw new InvalidSetpointError("setpoint must be an object.");
  }

  if (
    typeof value.setpoint.value !== "number" ||
    !Number.isFinite(value.setpoint.value)
  ) {
    throw new InvalidSetpointError("setpoint.value must be a finite number.");
  }

  if (value.setpoint.unit !== "kW") {
    throw new InvalidSetpointError("setpoint.unit must be 'kW'.");
  }

  if (typeof value.setpoint.endTime !== "string") {
    throw new InvalidSetpointError("setpoint.endTime must be an ISO date string.");
  }

  if (typeof value.eventTime !== "string") {
    throw new InvalidSetpointError("eventTime must be an ISO date string.");
  }

  return {
    device_id: value.device_id,
    setpoint: {
      value: value.setpoint.value,
      unit: value.setpoint.unit,
      endTime: value.setpoint.endTime,
    },
    eventTime: value.eventTime,
  };
}

export function isAcceptedDeviceId(deviceId: string): deviceId is AcceptedDeviceId {
  return (ACCEPTED_DEVICE_IDS as readonly string[]).includes(deviceId);
}

export function prepareSetpoint(
  message: IncomingSetpointMessage,
): PreparedSetpoint {
  if (!isAcceptedDeviceId(message.device_id)) {
    throw new InvalidSetpointError(
      `Device '${message.device_id}' is not in the accepted-device list.`,
    );
  }

  const eventTimeMs = Date.parse(message.eventTime);
  const endTimeMs = Date.parse(message.setpoint.endTime);

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

  return {
    deviceId: message.device_id,
    // Incoming values use the grid perspective; the API uses the battery perspective.
    // The minus sign reverses the direction and 1000 converts kilowatts to watts.
    valueWatts: Math.round(message.setpoint.value * -1_000),
    // The API accepts whole epoch seconds. Ceil avoids shortening the instruction.
    durationSeconds: Math.ceil(durationMs / 1_000),
  };
}

export function createApiRequest(
  setpoint: PreparedSetpoint,
  now: Date = new Date(),
): BatteredBatteriesRequest {
  if (!Number.isFinite(now.getTime())) {
    throw new InvalidSetpointError("The current time is invalid.");
  }

  // Add a small safety margin because the Swagger requires a future startTime.
  const startTime = Math.floor(now.getTime() / 1_000) + API_START_DELAY_SECONDS;

  return {
    data: {
      startTime,
      endTime: startTime + setpoint.durationSeconds,
      value: setpoint.valueWatts,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
