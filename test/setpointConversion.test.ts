import { describe, expect, it } from "vitest";
import {
  createApiRequest,
  parseIncomingSetpoint,
  prepareSetpoint,
} from "../src/domain/setpoint";

describe("setpoint conversion", () => {
  it("converts +1 kW from the grid perspective into a -1000 W API request lasting 60 seconds", () => {
    const incomingMessage = parseIncomingSetpoint({
      device_id: "BB00001",
      setpoint: {
        value: 1,
        unit: "kW",
        endTime: "2025-01-01T10:01:00.000Z",
      },
      eventTime: "2025-01-01T10:00:00.000Z",
    });

    const preparedSetpoint = prepareSetpoint(incomingMessage);
    const request = createApiRequest(
      preparedSetpoint,
      new Date("2025-01-01T12:00:00.000Z"),
    );

    expect(preparedSetpoint).toEqual({
      deviceId: "BB00001",
      valueWatts: -1000,
      durationSeconds: 60,
    });

    expect(request).toEqual({
      data: {
        startTime: 1735732802,
        endTime: 1735732862,
        value: -1000,
      },
    });
  });

  // TODO: Add a test proving that an unaccepted device ID is skipped without making an HTTP request.
  // TODO: Add a test proving that -2.5 kW from the grid perspective becomes +2500 W for battery charging.
  // TODO: Add a test proving that a duration shorter than 1 minute is rejected before an HTTP request.
  // TODO: Add a test proving that a duration longer than 1 hour is rejected before an HTTP request.
  // TODO: Add a test proving that malformed JSON is rejected with InvalidSetpointError.
  // TODO: Add a test proving that a unit other than kW is rejected before an HTTP request.
  // TODO: Add a test proving that HTTP 429 is retried and its Retry-After header is respected.
  // TODO: Add a test proving that an Axios timeout is retried with a bounded exponential delay.
  // TODO: Add a test proving that HTTP 500 is retried no more than the configured maximum attempt count.
  // TODO: Add a test proving that permanent HTTP 400, 401, and 404 responses are not retried.
  // TODO: Add a test proving that only HTTP 204 is accepted as a successful vendor response.
  // TODO: Add a test proving that messages from one device session are published sequentially in their received order.
  // TODO: Add an integration test proving that the deployed trigger accepts messages from the session-enabled queue.
  // TODO: Add a test proving that a failed accepted message rejects the invocation so Service Bus can retry the batch.
});
