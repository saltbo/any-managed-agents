@api @runners
Feature: Self-hosted runner work queue
  Self-hosted environments are serviced by registered runtime runners that lease AMA session work.

  @implemented
  Scenario: Publish runner queue routes in OpenAPI
    Given the Worker app is initialized
    When I request GET "/api/openapi.json"
    Then the OpenAPI document should include path "/api/runners"
    And the OpenAPI path "/api/runners" should include method "get"
    And the OpenAPI path "/api/runners" should include method "post"
    And the OpenAPI document should include path "/api/runners/{runnerId}/heartbeats"
    And the OpenAPI path "/api/runners/{runnerId}/heartbeats" should include method "post"
    And the OpenAPI document should include path "/api/runners/{runnerId}/leases"
    And the OpenAPI path "/api/runners/{runnerId}/leases" should include method "post"
    And the OpenAPI document should include path "/api/runners/{runnerId}/leases/{leaseId}"
    And the OpenAPI path "/api/runners/{runnerId}/leases/{leaseId}" should include method "patch"
    And the OpenAPI document should include path "/api/runners/{runnerId}/leases/{leaseId}/events"
    And the OpenAPI path "/api/runners/{runnerId}/leases/{leaseId}/events" should include method "post"
    And the OpenAPI document should include path "/api/runners/work-items"
    And the OpenAPI path "/api/runners/work-items" should include method "get"

  @implemented
  Scenario: Lease self-hosted session work to an eligible runner
    Given a self-hosted environment has an active runner
    When the user creates a session in that environment
    Then AMA queues session work without creating a Cloudflare Sandbox
    And the runner can claim a lease for the queued work
    And the runner can upload structured events and complete the lease

  @planned
  Scenario: Match self-hosted runners by exact runtime provider and model
    Given a self-hosted environment selects codex runtime
    And the agent selects an exact provider and model
    When the user creates a session in that environment
    Then AMA offers the session work only to runners that advertise the same runtime, provider, and model
    And runners that lack the exact combination cannot lease the work
    And the session remains pending with a waiting-for-runner reason until an eligible runner is available

  @implemented
  Scenario: Expire stale self-hosted runner leases
    Given a runner has leased self-hosted session work
    When the lease expires before renewal
    Then AMA returns retryable work to the available queue
    And the session exposes a safe waiting status
