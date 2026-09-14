import { afterEach, describe, expect, it } from "vitest";
import { startMockVendor } from "../../dev/mock-vendor.mjs";
import { BatteredBatteriesClient } from "../../src/infrastructure/http/batteredBatteriesClient";
import { processSetpointBatch } from "../../src/infrastructure/messaging/processSetpointBatch";

let vendor: Awaited<ReturnType<typeof startMockVendor>> | undefined;
afterEach(async () => { await vendor?.close(); vendor = undefined; });
const message = {
  device_id: "BB00001", setpoint: { value: 1, unit: "kW", endTime: "2025-01-01T10:01:00Z" },
  eventTime: "2025-01-01T10:00:00Z",
};
const logger = { log() {}, warn() {}, error() {} };

describe("real HTTP adapter against a loopback vendor", () => {
  it("decodes JSON and sends the expected authenticated HTTP request", async () => {
    vendor = await startMockVendor();
    const client = new BatteredBatteriesClient({ apiKey: "local-test-key", baseUrl: vendor.url,
      clock: () => new Date("2025-01-01T12:00:00Z") });
    await processSetpointBatch([JSON.stringify(message)], client, logger);
    expect(vendor.requests).toEqual([{ path: "/BB00001/setpoint", body: {
      data: { startTime: 1735732802, endTime: 1735732862, value: -1000 },
    } }]);
  });

  it("retries a real 429 response and completes", async () => {
    vendor = await startMockVendor({ statuses: [429, 204] });
    const client = new BatteredBatteriesClient({ apiKey: "local-test-key", baseUrl: vendor.url });
    await processSetpointBatch([message], client, logger);
    expect(vendor.requests).toHaveLength(2);
  });

  it("stops before the next message after exhausting real server failures", async () => {
    vendor = await startMockVendor({ statuses: [500] });
    const client = new BatteredBatteriesClient({ apiKey: "local-test-key", baseUrl: vendor.url, sleep: async () => {} });
    await expect(processSetpointBatch([message, { ...message, device_id: "BB00005" }], client, logger)).rejects.toThrow();
    expect(vendor.requests).toHaveLength(3);
    expect(vendor.requests.every(request => request.path === "/BB00001/setpoint")).toBe(true);
  });

  it("does not propagate Axios request configuration containing credentials to the host", async () => {
    vendor = await startMockVendor({ statuses: [400] });
    const client = new BatteredBatteriesClient({ apiKey: "local-test-key", baseUrl: vendor.url });
    const failure = await processSetpointBatch([message], client, logger).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("HTTP 400");
    expect(failure).not.toHaveProperty("config");
    expect(JSON.stringify(failure)).not.toContain("local-test-key");
  });
});
