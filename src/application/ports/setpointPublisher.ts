import { PreparedSetpoint } from "../../domain/battery/setpoint";

/** Outbound port: the application has no dependency on HTTP or Azure. */
export interface SetpointPublisher {
  publishSetpoint(setpoint: PreparedSetpoint): Promise<void>;
}
