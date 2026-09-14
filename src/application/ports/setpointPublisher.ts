import { PreparedSetpoint } from "../../domain/battery/setpoint";

// Outbound port: the application does not depend on HTTP, Axios, or Azure.
export interface SetpointPublisher {
  publishSetpoint(setpoint: PreparedSetpoint): Promise<void>;
}
