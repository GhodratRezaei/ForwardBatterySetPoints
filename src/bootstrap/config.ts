export const FUNCTION_NAME = "forwardBatterySetpoints";
export const SERVICE_BUS_QUEUE_NAME = "sbq-batbat-spt";

// Azure expects the application-setting name here, not the connection-string value.
export const SERVICE_BUS_CONNECTION_SETTING =
  "CONNECTION-STRING-SBQ-BATBAT-SPT";

export const DEFAULT_API_BASE_URL = "https://BatB.azure-api.net";

export interface AppConfig {
  apiKey: string;
  apiBaseUrl: string;
}

export function loadAppConfig(): AppConfig {
  return {
    apiKey: getRequiredEnvironmentVariable("BATTERED_BATTERIES_API_KEY"),
    apiBaseUrl:
      process.env.BATTERED_BATTERIES_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
  };
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Required environment variable '${name}' is missing.`);
  }

  return value;
}
