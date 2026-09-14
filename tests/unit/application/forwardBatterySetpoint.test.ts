import { describe, expect, it, vi } from "vitest";
import { ForwardBatterySetpoint } from "../../../src/application/use-cases/forwardBatterySetpoint";

const command = {
  deviceId: "BB00001", valueKilowatts: -2,
  eventTime: "2025-01-01T10:00:00Z", endTime: "2025-01-01T10:01:00Z",
};

describe("forward battery setpoint use case", () => {
  it("publishes through a port without any HTTP dependency", async () => {
    const publisher = { publishSetpoint: vi.fn().mockResolvedValue(undefined) };
    await new ForwardBatterySetpoint(publisher).execute(command);
    expect(publisher.publishSetpoint).toHaveBeenCalledWith({ deviceId: "BB00001", valueWatts: 2000, durationSeconds: 60 });
  });

  it("does not publish an invalid command", async () => {
    const publisher = { publishSetpoint: vi.fn() };
    await expect(new ForwardBatterySetpoint(publisher).execute({ ...command, endTime: "invalid" })).rejects.toThrow();
    expect(publisher.publishSetpoint).not.toHaveBeenCalled();
  });

  it("propagates an unsuccessful publication to the caller", async () => {
    const publisher = { publishSetpoint: vi.fn().mockRejectedValue(new Error("unavailable")) };
    await expect(new ForwardBatterySetpoint(publisher).execute(command)).rejects.toThrow("unavailable");
  });
});
