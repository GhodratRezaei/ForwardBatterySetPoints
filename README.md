# Battered Batteries setpoint forwarder

This project contains an Azure Functions v4 application written in TypeScript. It receives batches of battery setpoints from Azure Service Bus, validates and converts them, and forwards accepted commands to the Battered Batteries HTTP API.

The implementation is intentionally small. The queue trigger, conversion logic, batch orchestration, and HTTP client are kept separate so that each responsibility can be reviewed and tested independently.

## Processing flow

1. `forwardBatterySetpoints` receives a batch from queue `sbq-batbat-spt`.
2. `processSetpointBatch` decodes each message and filters the device ID.
3. `prepareSetpoint` validates the input and calculates the original duration.
4. `createApiRequest` converts the value and creates a new time window.
5. `BatteredBatteriesClient` sends the request with Axios.
6. HTTP 204 completes processing. Retryable failures receive a small number of delayed attempts.
7. If a request still fails, the handler throws and Azure Service Bus can redeliver the batch.

Messages inside an invocation are processed sequentially. This preserves ordering and avoids a burst of parallel calls to the unreliable vendor API.

## Data mapping

| Incoming data | Vendor request | Rule |
| --- | --- | --- |
| `device_id` | URL `/{device}/setpoint` | Must be in the accepted-device list |
| `setpoint.value` in kW | `data.value` in W | Multiply by `-1000` and round to a whole watt |
| `eventTime` and `setpoint.endTime` | Duration | `endTime - eventTime` |
| Processing time | `data.startTime` | Current epoch time plus two seconds |
| Preserved duration | `data.endTime` | New start time plus the original duration |

The sign is reversed because the systems use different perspectives. The incoming value is from the grid perspective, while the vendor API is from the battery perspective:

```text
+1 kW (discharge) -> -1000 W
-2.5 kW (charge)  -> +2500 W
```

For example, an input window from `10:00` until `10:01` has a duration of 60 seconds. If it is processed at `12:00`, the API window is approximately `12:00:02` until `12:01:02`. The two-second offset is used because the Swagger contract requires `startTime` to be in the future.

## Service Bus sessions and ordering

This implementation assumes that ordering is provided by Azure Service Bus sessions:

- queue `sbq-batbat-spt` is created with sessions enabled;
- the sender sets the Service Bus `SessionId` property to the message's `device_id`;
- the sender enqueues commands for a device in their intended processing order.

The trigger declares `isSessionsEnabled: true`. Messages for one battery therefore belong to one ordered session, while different batteries can be handled independently. The sequential loop in `processSetpointBatch` keeps the order delivered to one invocation.

Setting `isSessionsEnabled` in code does not modify the Azure queue and does not assign session IDs. Both must be configured by the queue owner and the producing application. If `SessionId` is not consistently equal to `device_id`, per-device ordering is not guaranteed.

## HTTP reliability policy

The Swagger document is the only available API contract, and there is no test environment. The client therefore uses conservative, bounded behaviour:

- API key supplied through `Ocp-Apim-Subscription-Key`;
- 8-second Axios timeout;
- at most three attempts per command;
- exponential delay with small random jitter;
- retry for a network error, timeout, HTTP 429, or HTTP 5xx;
- use `Retry-After` for HTTP 429, bounded by the configured maximum delay;
- no retry for HTTP 400, 401, or 404;
- only HTTP 204 is accepted as success.

The request time window is rebuilt immediately before every attempt. Otherwise, a retry delay could make `startTime` no longer future-dated.

## Batch failure and delivery guarantee

The trigger uses automatic settlement. When the function invocation succeeds, Azure completes the batch. When the function throws, Azure abandons the batch and its messages can be delivered again.

For example, if a batch contains `M1`, `M2`, and `M3`:

1. `M1` may receive HTTP 204.
2. `M2` may fail after all HTTP attempts.
3. The handler throws without sending `M3`, so `M3` cannot overtake `M2`.
4. Service Bus can redeliver the batch, including the already-forwarded `M1`.

The vendor endpoint replaces the current setpoint instead of creating additional records, so replay is reasonably safe and the session order leads to the correct final command once processing succeeds. It is still **at-least-once delivery**, not exactly-once delivery. A repeated request also receives newly calculated timestamps, so the operation is not strictly idempotent.

Exactly-once processing would require an additional mechanism not present in the task or Swagger contract, such as a vendor-supported idempotency key or a durable deduplication store keyed by Service Bus `MessageId`.

## One-second clearing command

The API has no DELETE operation. Because a new setpoint replaces the old one, an existing long-running command can be cancelled by replacing it with a one-second neutral command:

```json
{
  "data": {
    "startTime": 1735732802,
    "endTime": 1735732803,
    "value": 0
  }
}
```

The new command overrides the previous command, requests zero power for one second, and then expires, leaving no active setpoint. I assume `0 W` is the safest neutral value because the assignment does not specify the value used in the vendor demonstration.

This clearing behaviour is not part of the implemented input flow. Incoming setpoints are stated to last from one minute to one hour, and the supplied message schema has no cancellation field. Sending a one-second command after every normal request would cancel valid setpoints and would be incorrect. If cancellation becomes a requirement, it should be represented explicitly in the incoming contract.

## Other assumptions

- “Active from moment of arrival” means active as soon as the vendor can accept the forwarded request. A small future offset is necessary to satisfy the API contract.
- `eventTime` and `setpoint.endTime` describe the intended duration; their old absolute window is not forwarded.
- Durations outside one minute to one hour are invalid because the assignment defines that range.
- Fractional kilowatts are allowed and rounded to the nearest whole watt because the API schema requires an integer.
- A malformed accepted-device message fails the batch and can eventually reach the Service Bus dead-letter queue.
- I interpret “abandon” for an unknown device as remove it from the application flow: log and skip it. A formal Service Bus abandon would repeatedly redeliver a permanently unsupported ID and could unnecessarily load the system. If broker-level abandon is required instead, message settlement must be redesigned explicitly.
- The queue, connection string, deployment infrastructure, and producer are outside this repository and are assumed to exist.

## Project structure

```text
src/
├── index.ts                         Function registration entry point
├── config.ts                        Constants and environment configuration
├── domain/setpoint.ts               Input validation and conversion
├── functions/forwardBatterySetpoints.ts
└── services/
    ├── batteredBatteriesClient.ts   Axios client, timeout, and retry policy
    └── processSetpointBatch.ts      Filtering and sequential batch processing
test/
└── setpointConversion.test.ts       One implemented test and TODO test cases
```

Azure Functions v4 registers the trigger in TypeScript with `app.serviceBusQueue(...)`, so there is no `function.json` file.

## Configuration

No credentials are committed. Copy `local.settings.example.json` to `local.settings.json` and provide:

- `CONNECTION-STRING-SBQ-BATBAT-SPT`
- `BATTERED_BATTERIES_API_KEY`
- optionally, `BATTERED_BATTERIES_BASE_URL`

`local.settings.json` is ignored by Git. The value passed to the trigger's `connection` option is the name of the application setting, not the connection string itself.

## Build and test

Use Node.js 22 or 24.

```bash
npm install
npm run check
```

`npm run check` compiles the TypeScript source into `dist/` and runs Vitest. The assignment requests one implemented test, so the suite contains exactly one test. It checks the main conversion: an accepted `+1 kW`, 60-second command becomes a `-1000 W`, 60-second vendor request. The remaining scenarios are listed as descriptive TODO comments in the test file.

Starting the Function locally requires Azure Functions Core Tools and real Service Bus/vendor configuration:

```bash
npm start
```

Because the vendor provides no test environment, build and unit tests are safe, but the Function should not be started with real credentials without permission to consume the queue and call the production API.

## Known trade-offs

- Automatic batch settlement can replay messages that already caused an HTTP side effect.
- A poison message can block later messages in the same ordered device session until it succeeds or is dead-lettered.
- Sequential processing limits load within one invocation, but it is not a global rate limiter across all sessions and scaled Function instances.
- The supplied API has no idempotency key, status lookup, or test endpoint, so integration behaviour cannot be verified safely here.

For a production deployment, I would confirm the intended unknown-device settlement rule, add metrics and dead-letter monitoring, agree a global rate limit with the vendor, and introduce idempotency or durable deduplication if the business requires stronger delivery guarantees.

## References

- [Azure Functions Service Bus trigger](https://learn.microsoft.com/azure/azure-functions/functions-bindings-service-bus-trigger)
- [Azure Service Bus message sessions](https://learn.microsoft.com/azure/service-bus-messaging/message-sessions)
