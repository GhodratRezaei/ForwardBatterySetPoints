import { isAcceptedDeviceId, prepareSetpoint, PreparedSetpoint, SetpointCommand } from "../../domain/battery/setpoint";
import { SetpointPublisher } from "../ports/setpointPublisher";

export class ForwardBatterySetpoint {
  public constructor(private readonly publisher: SetpointPublisher) {}

  public acceptsDevice(deviceId: string): boolean {
    return isAcceptedDeviceId(deviceId);
  }

  public async execute(command: SetpointCommand): Promise<PreparedSetpoint> {
    const setpoint = prepareSetpoint(command);
    await this.publisher.publishSetpoint(setpoint);
    return setpoint;
  }
}
