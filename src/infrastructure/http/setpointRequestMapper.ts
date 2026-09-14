import { InvalidSetpointError, PreparedSetpoint } from "../../domain/battery/setpoint";

// The vendor requires startTime to be in the future when it receives the request.
const API_START_DELAY_SECONDS = 2;

export interface BatteredBatteriesRequest {
  data: {
    startTime: number;
    endTime: number;
    value: number;
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

