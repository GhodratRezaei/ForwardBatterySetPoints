import { describe, expect, it } from "vitest";
import { prepareSetpoint, SetpointCommand } from "../../../src/domain/battery/setpoint";

const command: SetpointCommand = {
  deviceId: "BB00001", valueKilowatts: 1,
  eventTime: "2025-01-01T10:00:00Z", endTime: "2025-01-01T10:01:00Z",
};

describe("battery setpoint value object", () => {
  it("converts grid power and returns an immutable value", () => {
    const value = prepareSetpoint(command);
    expect(value).toEqual({ deviceId: "BB00001", valueWatts: -1000, durationSeconds: 60 });
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each([NaN, Infinity, Number.MAX_VALUE])("rejects unsafe power %s at the domain boundary", valueKilowatts => {
    expect(() => prepareSetpoint({ ...command, valueKilowatts })).toThrow();
  });

  it("rejects unsupported devices even when called without a transport adapter", () => {
    expect(() => prepareSetpoint({ ...command, deviceId: "UNKNOWN" })).toThrow("not in the accepted-device list");
  });

  it("accepts the exact one-hour duration boundary", () => {
    expect(prepareSetpoint({ ...command, endTime: "2025-01-01T11:00:00Z" }).durationSeconds).toBe(3600);
  });
});
