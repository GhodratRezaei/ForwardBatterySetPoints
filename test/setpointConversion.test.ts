import axios, { AxiosInstance } from "axios";
// Vitest helpers group tests, define cases, make assertions, and create mocks.
import { describe, expect, it, vi } from "vitest";
import {
  createApiRequest,
  InvalidSetpointError,
  parseIncomingSetpoint,
  prepareSetpoint,
} from "../src/domain/setpoint";
import { processSetpointBatch } from "../src/services/processSetpointBatch";
import { BatteredBatteriesClient } from "../src/services/batteredBatteriesClient";

// Groups all tests related to setpoint validation, conversion, and processing.
describe("setpoint conversion", () => {
  // Verifies validation, unit conversion, duration calculation, and API timestamps.
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

  // Verifies that negative grid power becomes positive battery power in watts.
  it("converts -2.5 kW from the grid perspective into +2500 W", () => {
    const message = parseIncomingSetpoint({
      device_id: "BB00001",
      setpoint: {
        value: -2.5,
        unit: "kW",
        endTime: "2025-01-01T10:01:00.000Z",
      },
      eventTime: "2025-01-01T10:00:00.000Z",
    });

    expect(prepareSetpoint(message).valueWatts).toBe(2500);
  });

  // Verifies that durations outside the one-minute-to-one-hour range are rejected.
  it.each([
    ["short", "2025-01-01T10:00:59.999Z"],
    ["long", "2025-01-01T11:00:00.001Z"],
  ])("rejects a %s duration before an HTTP request", (_, endTime) => {
    expect(() =>
      prepareSetpoint(
        parseIncomingSetpoint({
          device_id: "BB00001",
          setpoint: { value: 1, unit: "kW", endTime },
          eventTime: "2025-01-01T10:00:00.000Z",
        }),
      ),
    ).toThrow(InvalidSetpointError);
  });

  // Verifies that invalid JSON is reported as an invalid setpoint.
  it("rejects malformed JSON with InvalidSetpointError", () => {
    expect(() => parseIncomingSetpoint("not JSON")).toThrow(
      InvalidSetpointError,
    );
  });

  // Verifies that the parser accepts only the required kilowatt unit.
  it("rejects a unit other than kW before an HTTP request", () => {
    expect(() =>
      parseIncomingSetpoint({
        device_id: "BB00001",
        setpoint: {
          value: 1,
          unit: "W",
          endTime: "2025-01-01T10:01:00.000Z",
        },
        eventTime: "2025-01-01T10:00:00.000Z",
      }),
    ).toThrow(InvalidSetpointError);
  });

  // Verifies that unknown devices are skipped without calling the vendor client.
  it("skips an unaccepted device without making an HTTP request", async () => {
    const client = {
      publishSetpoint: vi.fn(),
    } as unknown as BatteredBatteriesClient;
    const context = createContext();

    await processSetpointBatch([validMessage("UNKNOWN")], client, context);

    expect(client.publishSetpoint).not.toHaveBeenCalled();
    expect(context.warn).toHaveBeenCalledOnce();
  });

  // Verifies that HTTP 429 is retried after the server-provided delay.
  it("retries HTTP 429 using the Retry-After delay", async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(axiosError(429, { "retry-after": "3" }))
      .mockResolvedValueOnce({ status: 204 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createClient(post, sleep);

    await client.publishSetpoint(preparedSetpoint());

    expect(post).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  // Verifies timeout retries use increasing delays with bounded jitter.
  it("retries a timeout with bounded exponential delays", async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(axiosError(undefined, undefined, "ECONNABORTED"))
      .mockRejectedValueOnce(axiosError(undefined, undefined, "ETIMEDOUT"))
      .mockResolvedValueOnce({ status: 204 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createClient(post, sleep);

    await client.publishSetpoint(preparedSetpoint());

    expect(post).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(500);
    expect(sleep.mock.calls[0][0]).toBeLessThan(750);
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(1000);
    expect(sleep.mock.calls[1][0]).toBeLessThan(1250);
  });

  // Verifies a retryable server error is attempted at most three times.
  it("does not retry HTTP 500 more than the maximum attempt count", async () => {
    const post = vi.fn().mockRejectedValue(axiosError(500));
    const client = createClient(post, vi.fn().mockResolvedValue(undefined));

    await expect(client.publishSetpoint(preparedSetpoint())).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(3);
  });

  // Verifies permanent client and authentication errors are not retried.
  it.each([400, 401, 404])(
    "does not retry permanent HTTP %s responses",
    async (status) => {
      const post = vi.fn().mockRejectedValue(axiosError(status));
      const client = createClient(post, vi.fn().mockResolvedValue(undefined));

      await expect(client.publishSetpoint(preparedSetpoint())).rejects.toThrow();
      expect(post).toHaveBeenCalledOnce();
    },
  );

  // Verifies that the vendor contract accepts only HTTP 204 as success.
  it("accepts only HTTP 204 as a successful vendor response", async () => {
    const post = vi.fn().mockResolvedValue({ status: 200 });
    const client = createClient(post, vi.fn().mockResolvedValue(undefined));

    await expect(client.publishSetpoint(preparedSetpoint())).rejects.toThrow(
      "unexpected HTTP 200",
    );
    expect(post).toHaveBeenCalledOnce();
  });

  // Verifies that messages are published one at a time in received order.
  it("publishes messages sequentially in received order", async () => {
    const calls: string[] = [];
    const client = {
      publishSetpoint: vi.fn(async (setpoint: { deviceId: string }) => {
        calls.push(`start:${setpoint.deviceId}`);
        await Promise.resolve();
        calls.push(`end:${setpoint.deviceId}`);
      }),
    } as unknown as BatteredBatteriesClient;

    await processSetpointBatch(
      [validMessage("BB00001"), validMessage("BB00005")],
      client,
      createContext(),
    );

    expect(calls).toEqual([
      "start:BB00001",
      "end:BB00001",
      "start:BB00005",
      "end:BB00005",
    ]);
  });

  // Verifies that an accepted-message failure rejects the whole invocation.
  it("rejects the invocation when an accepted message fails", async () => {
    const client = {
      publishSetpoint: vi.fn().mockRejectedValue(new Error("vendor failed")),
    } as unknown as BatteredBatteriesClient;

    await expect(
      processSetpointBatch([validMessage("BB00001")], client, createContext()),
    ).rejects.toThrow("vendor failed");
  });

  // Verifies that a batch can be passed through the trigger handler contract.
  it("accepts a batch through the trigger handler contract", async () => {
    const client = {
      publishSetpoint: vi.fn().mockResolvedValue(undefined),
    } as unknown as BatteredBatteriesClient;

    await processSetpointBatch(
      [validMessage("BB00001")],
      client,
      createContext(),
    );

    expect(client.publishSetpoint).toHaveBeenCalledOnce();
  });
});

function validMessage(deviceId: string): object {
  return {
    device_id: deviceId,
    setpoint: {
      value: 1,
      unit: "kW",
      endTime: "2025-01-01T10:01:00.000Z",
    },
    eventTime: "2025-01-01T10:00:00.000Z",
  };
}

function preparedSetpoint() {
  return {
    deviceId: "BB00001" as const,
    valueWatts: -1000,
    durationSeconds: 60,
  };
}

function createClient(
  post: ReturnType<typeof vi.fn>,
  sleep: ReturnType<typeof vi.fn>,
): BatteredBatteriesClient {
  return new BatteredBatteriesClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    httpClient: { post } as unknown as AxiosInstance,
    sleep,
  });
}

function axiosError(
  status?: number,
  headers?: Record<string, string>,
  code?: string,
): unknown {
  return Object.assign(new Error("request failed"), {
    isAxiosError: true,
    code,
    response:
      status === undefined
        ? undefined
        : { status, headers: headers ?? {}, data: undefined },
  });
}

function createContext() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
}
