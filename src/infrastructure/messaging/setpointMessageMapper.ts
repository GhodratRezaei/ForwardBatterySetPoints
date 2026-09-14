import { InvalidSetpointError, SetpointCommand } from "../../domain/battery/setpoint";

// Normalize the transport representation before applying message validation.
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

export function parseIncomingSetpoint(rawMessage: unknown): SetpointCommand {
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
    deviceId: value.device_id,
    valueKilowatts: value.setpoint.value,
    endTime: value.setpoint.endTime,
    eventTime: value.eventTime,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
