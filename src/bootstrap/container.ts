import { SetpointPublisher } from "../application/ports/setpointPublisher";
import { BatteredBatteriesClient } from "../infrastructure/http/batteredBatteriesClient";
import { loadAppConfig } from "./config";

let publisher: SetpointPublisher | undefined;

/** One publisher per worker process; tests inject their own publisher port. */
export function getSetpointPublisher(): SetpointPublisher {
  if (!publisher) {
    const config = loadAppConfig();
    publisher = new BatteredBatteriesClient({
      apiKey: config.apiKey,
      baseUrl: config.apiBaseUrl,
    });
  }
  return publisher;
}
