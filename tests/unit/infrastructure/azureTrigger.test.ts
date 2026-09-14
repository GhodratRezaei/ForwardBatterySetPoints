import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  publish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@azure/functions", () => ({ app: { serviceBusQueue: mocks.register } }));
vi.mock("../../../src/bootstrap/container", () => ({
  getSetpointPublisher: () => ({ publishSetpoint: mocks.publish }),
}));

import "../../../src/index";
import { forwardBatterySetpoints } from "../../../src/interfaces/azure-functions/forwardBatterySetpoints";
import { InvocationContext } from "@azure/functions";

// Registration occurs on module load, before Vitest restores mocks per test.
const registeredTriggers = [...mocks.register.mock.calls];

describe("Azure trigger boundary", () => {
  it("registers the expected session-enabled batch trigger from the entry point", () => {
    expect(registeredTriggers).toEqual([["forwardBatterySetpoints", expect.objectContaining({
      queueName: "sbq-batbat-spt", connection: "ServiceBusConnection",
      isSessionsEnabled: true, cardinality: "many", autoCompleteMessages: true,
      handler: forwardBatterySetpoints,
    })]]);
  });

  it("adapts an invocation to the configured publisher", async () => {
    const context = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as InvocationContext;
    await forwardBatterySetpoints([{
      device_id: "BB00001", eventTime: "2025-01-01T10:00:00Z",
      setpoint: { value: 1, unit: "kW", endTime: "2025-01-01T10:01:00Z" },
    }], context);
    expect(mocks.publish).toHaveBeenCalledWith({ deviceId: "BB00001", valueWatts: -1000, durationSeconds: 60 });
  });
});
