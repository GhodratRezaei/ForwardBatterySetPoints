# Deployment and CI/CD proposal

## Proposed company design

Use Azure Functions v4 on Linux Flex Consumption with Node.js 24. Use Terraform for Azure resources and configuration; use Azure DevOps to build, test and deploy application packages. This keeps infrastructure changes reviewable and lets a tested application artifact move through environments without rebuilding it.

These are executable examples after setup, not a claim that the company's Azure landing zone, identities, approvals or pipelines already exist. Azure DevOps is the selected example because this is an Azure service; the same artifact/state separation works in GitHub Actions if that is the company's source platform.

```mermaid
flowchart LR
    Dev[Developer branch] --> PR[Pull request and review]
    PR --> CI[Build and safe tests]
    CI --> Merge[Protected main branch]
    Merge --> Artifact[Versioned function ZIP and checksum]
    Artifact --> DevDeploy[Development deployment]
    DevDeploy --> Acceptance[Development acceptance evidence]
    Acceptance --> Gate[Production environment approval]
    Gate --> Prod[Deploy same ZIP to production]
    Prod --> Observe[Monitor processing and errors]
```

## Azure runtime architecture

```mermaid
flowchart TB
    subgraph External[Outside this service]
      Producer[Command producer]
      Vendor[Vendor HTTPS API]
    end
    subgraph Azure[One Azure environment]
      Queue[(Session-enabled Service Bus queue)]
      DLQ[(Dead-letter queue)]
      Plan[Flex Consumption FC1 plan]
      App[Function App with Node.js 24]
      Host[Functions host and Service Bus extension]
      Worker[Node worker loads dist/index.js]
      Storage[(Host storage and deployment container)]
      KV[(Key Vault vendor key)]
      Identity[Function managed identity]
      Insights[Application Insights]
      Logs[(Log Analytics)]
      Alerts[Metric alerts and action group]
      Plan --- App
      App --> Host
      Host --> Worker
      Storage --> App
      Identity --> Queue
      Identity --> Storage
      Identity --> KV
      KV --> App
      Worker --> Insights --> Logs
      Queue -. repeated failure .-> DLQ
      Queue --> Alerts
      Insights --> Alerts
    end
    Producer -->|SessionId = device_id| Queue
    Queue --> Host
    Worker -->|Authenticated HTTP| Vendor
```

The Functions host manages trigger listening, session locks, invocation and message completion. The Node worker loads `dist/index.js`; importing the Azure adapter registers `forwardBatterySetpoints`. Azure executes the compiled JavaScript, not the original TypeScript. The broker triggers execution; this app does not expose an application HTTP endpoint for producers.

```mermaid
sequenceDiagram
    participant CD as Release pipeline
    participant Deploy as Azure One Deploy
    participant Blob as Deployment storage
    participant Host as Functions host
    participant Node as Node worker
    participant SB as Service Bus
    CD->>Deploy: Tested ZIP via federated Azure connection
    Deploy->>Blob: Store application package
    Host->>Blob: Load deployed package
    Host->>Node: Start configured Node runtime
    Node->>Node: Load dist/index.js and register trigger
    Host->>SB: Authenticate and listen for sessions
    SB->>Host: Deliver available messages
    Host->>Node: Invoke handler
    Node-->>Host: Success or failure
    Host->>SB: Complete on success or recover on failure
```

Flex is Microsoft's recommended serverless plan and uses One Deploy. It has no deployment slots. The sample uses separate dev/prod Function Apps. The production example requests one always-ready instance for lower cold-start latency; actual latency and capacity must be measured. [Flex hosting](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan), [deployment technology](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies), [runtime versions](https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages).

## Infrastructure and application ownership

```mermaid
flowchart TB
    Repo[Version-controlled repository] --> TF[Terraform pipeline]
    Repo --> CI[Application CI]
    TF --> Plan[Saved plan and review text]
    Plan --> Approve[Infrastructure environment approval]
    Approve --> Apply[Apply exactly the saved plan]
    Apply --> Resources[Resources, identities, settings and alerts]
    CI --> ZIP[Compiled application ZIP]
    ZIP --> CD[Application release pipeline]
    CD --> Package[One Deploy package]
    Resources --> Runtime[Running Function App]
    Package --> Runtime
```

Terraform owns the queue, Function App configuration, identities, roles, storage, Key Vault, monitoring and trigger activation setting. The application pipeline owns the code package. The configuration intentionally does not use Terraform `zip_deploy_file`, provisioners, `local-exec` or legacy `WEBSITE_RUN_FROM_PACKAGE` switches. Application rollback does not require rolling back infrastructure.

| Terraform example resource | Purpose |
| --- | --- |
| `azurerm_function_app_flex_consumption` and `azurerm_service_plan` | Node.js 24 execution on FC1 |
| `azurerm_servicebus_namespace` and queue | Standard tier, sessions, five-minute lock, delivery limit |
| `azurerm_storage_account` and container | Host metadata and deployment packages |
| `azurerm_key_vault` | Vendor credential reference; secret value supplied separately |
| Role assignments | Queue receive, host storage, secret read |
| Insights, workspace, alerts | Telemetry and initial operational notifications |

The pinned Terraform and AzureRM versions are a reproducible sample baseline, not a claim to be the latest releases. Upgrade them through reviewed dependency changes and validation. `.terraform.lock.hcl` files are committed; state and downloaded providers are ignored.

## Identity and secret flow

```mermaid
flowchart LR
    Pipeline[Azure DevOps job] -->|Federated assertion| Entra[Microsoft Entra ID]
    Entra -->|Short-lived token| DeployIdentity[Deployment or infrastructure identity]
    DeployIdentity --> ARM[Azure resource management]
    InfraIdentity[Infrastructure identity] --> State[(Terraform state storage)]
    Function[Function managed identity] -->|Receiver role| Queue[(Service Bus queue)]
    Function -->|Blob Data Owner| Storage[(Function host storage)]
    Function -->|Secrets User| KV[(Key Vault)]
    KV -->|App setting reference| Key[Vendor API key in process]
    Key --> Vendor[Vendor request header]
```

Separate infrastructure and deployment identities per environment. Infrastructure needs resource creation and role-assignment permissions at the chosen scope plus backend blob access. Deployment needs permissions to publish to the target Function App; it does not need the vendor key. The producer needs its own sender role. Runtime has a receiver role scoped to its queue and no sender role.

The sample uses a system-assigned Function identity. Its roles are assigned after the app exists; allow RBAC propagation before the first deployment/activation. Key Vault references use that identity. The key is not a Terraform input, resource or data-source value, so Terraform does not persist it in state. Secret operators supply `vendor-api-key` to the vault outside Terraform. [Identity-based trigger connections](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger), [Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references).

## Configure the three pipelines

**CI — `azure-pipelines.yml`**

Create an Azure DevOps pipeline named `battery-forwarder-ci`. It compiles, runs safe tests, publishes JUnit results, stages only runtime files and production dependencies, and publishes `function.zip`, its SHA-256 and source commit. An independent job checks Terraform formatting and provider validation without using Azure credentials. For Azure Repos, configure build validation as a branch policy; YAML `pr` triggers alone do not provide Azure Repos PR validation.

**Infrastructure — `pipelines/infrastructure.yml`**

Create a manual pipeline from this file. Create federated Azure Resource Manager service connections `battery-dev-infra` and `battery-prod-infra`. Create variable groups `battery-dev-infra` and `battery-prod-infra` with:

| Variable | Example / meaning |
| --- | --- |
| `StateResourceGroup` | Existing state resource group |
| `StateStorageAccount` | Existing backend storage account |
| `SubscriptionId` | Target subscription UUID |
| `NamePrefix` | Globally unique lowercase name prefix |
| `Location` | `westeurope`, after checking availability |
| `VendorBaseUrl` | Approved HTTPS mock in dev; vendor in prod |
| `AlertEmail` | Team alert address |
| `EnableTrigger` | Initially `false`; deliberately activate later |
| `AlwaysReadyInstances` | `0` for dev, `1` as a production starting point |

Create environments `battery-dev-infra` and `battery-prod-infra`, restrict their pipelines/branches, and configure approvals on Apply. Review `infra-plan/review.txt` before approval. Apply downloads and uses the saved binary plan from the same run; it does not silently replan. Treat plan artifacts and state as sensitive operational data and restrict retention/access. If state changed since planning, Terraform rejects a stale plan; rerun and review it.

**Application release — `pipelines/release.yml`**

Create federated service connections `battery-dev-deploy` and `battery-prod-deploy`, and environments `battery-dev` and `battery-prod`. Set pipeline variables `DevFunctionApp`, `DevResourceGroup`, `ProdFunctionApp`, and `ProdResourceGroup` using Terraform outputs. Restrict the production environment to approved pipelines and protected branches and configure its reviewer check.

Choose a successful main-branch CI resource version when manually running a release. Both stages download the same CI artifact and verify its checksum/commit. A read-only API gate also verifies that the complete source CI run succeeded, so a package from a run with failed Terraform validation cannot be promoted. Grant the release job's Build Service identity permission to view source builds/artifacts; `System.AccessToken` is mapped only to that verification step. `AzureFunctionApp@2` uses `isFlexConsumption: true`. The post-deploy check verifies trigger registration; it does not send a live battery command. Review development acceptance evidence before approving production. Environment approval policies are configured in Azure DevOps, not silently created by YAML. [Azure Functions deployment task](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/azure-function-app-v2?view=azure-pipelines), [build verification API](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/builds/get?view=azure-devops-rest-7.1).

```mermaid
flowchart LR
    CI[Successful main CI run] --> Artifact[ZIP plus checksum and commit]
    Artifact --> VerifyDev[Verify checksum in dev]
    VerifyDev --> DeployDev[Deploy to dev]
    DeployDev --> RegisterDev[Check trigger registration]
    RegisterDev --> Evidence[Review cloud acceptance evidence]
    Evidence --> Approval[Configured production approval]
    Approval --> VerifyProd[Verify same artifact]
    VerifyProd --> DeployProd[Deploy to prod]
    DeployProd --> RegisterProd[Check trigger registration and observe]
```

Protect release YAML and service connections as well as application code. A trusted artifact alone does not make an unreviewed release pipeline trusted. Source pipelines, selected artifacts and environment checks must all be covered by company access policy.

## Rollback and release behavior

Flex deployment may restart workers. Queue delivery makes commands durable but does not eliminate duplicates around in-flight HTTP calls. There are no slots in this design, and two active test/prod consumers must not share the production queue as an accidental canary.

```mermaid
flowchart TD
    Alert[Regression after release] --> Assess[Assess active commands and vendor effects]
    Assess --> Pause{Pause consumption needed?}
    Pause -->|Yes| Disable[Disable trigger using controlled configuration]
    Pause -->|No| Select[Select previous successful CI artifact]
    Disable --> Select
    Select --> Redeploy[Redeploy through dev and production gates]
    Redeploy --> Verify[Verify registration and processing evidence]
    Verify --> Resume[Restore intended trigger state and monitor]
```

For rollback, select a retained previous CI run in the same release pipeline; no code rebuild is needed. Confirm the old code remains compatible with current settings and queue contracts. An application rollback cannot undo a battery command already accepted by the vendor. Emergency configuration changes must be reconciled back into Terraform.

## Scope and proposed extensions

The sample uses authenticated public Azure endpoints and Standard Service Bus. A company landing zone may require private endpoints, Service Bus Premium, VNet integration, private DNS and a network-connected pipeline agent. Those are explicit landing-zone extensions, not provisioned here. The HTTPS mock in Azure, enterprise federation bootstrap and actual cloud acceptance automation also remain company setup tasks.

The Terraform configuration supplies initial dead-letter and failed-invocation alerts. Add measured queue-age objectives, vendor latency/rate metrics, operational dashboards and an agreed replay policy before production activation. Avoid treating Azure autoscaling as a vendor rate limiter.
