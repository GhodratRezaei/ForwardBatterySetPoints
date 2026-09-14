# Source architecture

## Bounded context

The context is **battery setpoint forwarding**: translating a producer's grid command into a vendor battery command. It does not own inventory, scheduling, billing or physical battery execution.

```mermaid
flowchart LR
    subgraph ProducerContext[Producer context]
      Schedule[Scheduling decisions] --> Wire[Producer schema]
    end
    subgraph Forwarding[Battery forwarding context]
      Decode[Incoming schema adapter] --> Command[SetpointCommand]
      Command --> Rules[Device and power-duration rules]
      Rules --> Value[PreparedSetpoint]
      Value --> Encode[Vendor schema adapter]
    end
    subgraph VendorContext[Vendor context]
      API[Command API] --> Battery[Battery execution]
    end
    Wire --> Decode
    Encode --> API
```

| Domain term | Meaning |
| --- | --- |
| SetpointCommand | Device, grid power and original time interval |
| AcceptedDeviceId | A device in the assignment allowlist |
| PreparedSetpoint | Immutable battery watts and duration, produced by a validating factory |
| SetpointPublisher | Capability to deliver a prepared setpoint |

The schema adapters isolate snake_case producer fields and vendor JSON wrappers from the domain. This is pragmatic DDD with ports and adapters. There is no persisted aggregate or repository because the service currently has no local business state. If durable deduplication or latest-command state becomes a requirement, model that state explicitly and introduce a persistence port.

## Dependency direction

Arrows below indicate source dependencies. The architecture test enforces allowed import directions. Runtime calls can flow through a port into its concrete implementation.

```mermaid
flowchart TB
    Entry[index.ts] --> Azure[interfaces/azure-functions]
    Azure --> Bootstrap[bootstrap]
    Azure --> Messaging[infrastructure/messaging]
    Bootstrap --> HTTP[infrastructure/http]
    Messaging --> UseCase[application/use-cases]
    UseCase --> Port[application/ports/SetpointPublisher]
    UseCase --> Domain[domain/battery]
    HTTP --> Port
    HTTP --> Domain
    Port --> Domain
```

| Layer | Responsibility | Dependencies it must avoid |
| --- | --- | --- |
| Domain | Device eligibility, duration, power conversion, immutable values | Azure, Axios, environment variables, transport parsing |
| Application | Validate and publish one command through a port | Azure and concrete adapters |
| Infrastructure | Wire decoding, vendor mapping, HTTP and retries | Bootstrap and trigger registration |
| Interfaces | Register trigger and bridge the invocation | Business calculations |
| Bootstrap | Read settings and construct dependencies | Business decisions |

```mermaid
classDiagram
    class SetpointCommand {
      +string deviceId
      +number valueKilowatts
      +string eventTime
      +string endTime
    }
    class PreparedSetpoint {
      +AcceptedDeviceId deviceId
      +number valueWatts
      +number durationSeconds
    }
    class ForwardBatterySetpoint {
      +acceptsDevice(deviceId) boolean
      +execute(command) Promise
    }
    class SetpointPublisher {
      <<interface>>
      +publishSetpoint(setpoint) Promise
    }
    class BatteredBatteriesClient {
      +publishSetpoint(setpoint) Promise
    }
    ForwardBatterySetpoint ..> SetpointCommand
    ForwardBatterySetpoint ..> PreparedSetpoint
    ForwardBatterySetpoint --> SetpointPublisher
    BatteredBatteriesClient ..|> SetpointPublisher
```

## Composition and execution

`bootstrap/container.ts` lazily creates one HTTP client per worker process. This is not a global distributed singleton: multiple Azure instances have independent clients. Tests construct the use case with fake ports or a publisher pointing at the loopback server.

```mermaid
sequenceDiagram
    participant SB as Service Bus
    participant Host as Functions host
    participant Adapter as Azure and messaging adapters
    participant UC as ForwardBatterySetpoint
    participant D as Domain factory
    participant HTTP as HTTP publisher
    participant API as Vendor
    SB->>Host: Locked session batch, at most five
    Host->>Adapter: Invoke with message array
    loop Each message sequentially
      Adapter->>Adapter: Decode and inspect device
      alt Unknown device
        Adapter->>Adapter: Log skip
      else Accepted device
        Adapter->>Adapter: Map to SetpointCommand
        Adapter->>UC: execute(command)
        UC->>D: prepareSetpoint(command)
        D-->>UC: Immutable value
        UC->>HTTP: publishSetpoint(value)
        HTTP->>HTTP: Build future time window
        HTTP->>API: Authenticated POST
        API-->>HTTP: HTTP 204
        HTTP-->>UC: Success
        UC-->>Adapter: Published value
      end
    end
    Adapter-->>Host: Invocation succeeds
    Host->>SB: Complete delivered messages
```

## Failures and ordering

```mermaid
flowchart TD
    Message[Next message] --> Device{Accepted device?}
    Device -->|No| Skip[Log and skip]
    Device -->|Yes| Validation{Valid command?}
    Validation -->|No| Fail[Throw and stop batch]
    Validation -->|Yes| Send[Call vendor]
    Send --> Response{Result}
    Response -->|204| Next[Continue]
    Response -->|Network, 429 or 5xx| Retry{Attempts remain?}
    Retry -->|Yes| Wait[Wait and rebuild time window]
    Wait --> Send
    Retry -->|No| Fail
    Response -->|Other status| Fail
    Fail --> Broker[Broker redelivery policy]
    Broker -->|Limit exceeded| DLQ[Dead-letter queue]
    Broker -->|Retry eligible| Message
```

```mermaid
flowchart LR
    subgraph Sessions[Per-device sessions]
      A1[Battery A command 1] --> A2[Battery A command 2]
      B1[Battery B command 1] --> B2[Battery B command 2]
    end
    A1 --> RA[Receiver owns session A]
    A2 --> RA
    B1 --> RB[Receiver owns session B]
    B2 --> RB
    RA --> Vendor[Shared vendor API capacity]
    RB --> Vendor
```

Sessions coordinate receiver ownership, and the sequential loop preserves received order. Neither gives exactly-once HTTP side effects or a global vendor rate limit. Manually replaying dead letters also changes their broker ordering. Cloud acceptance tests must verify actual host/session recovery.

## Decisions retained and future extensions

- Retain the batch trigger contract, now capped at five. Single-message invocation is a possible later change that reduces replay scope.
- Keep the allowlist in the domain until an actual inventory service becomes authoritative.
- Preserve rebuilding the time interval from processing time. Expiry and latest-command-wins require a business decision.
- Do not add a deduplication database without defining the crash window after HTTP success and before broker completion. Vendor idempotency or reconciliation is needed to resolve ambiguous outcomes.

References: [Service Bus sessions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions), [Functions Service Bus binding](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus).
