@v1 @implemented
Feature: v1.0 release acceptance
  The first release is accepted only when the documented platform can create a
  session that routes work to a managed agent runtime.

  Scenario: Release documentation covers required platform setup
    Then the v1 release docs describe FlareAuth OIDC setup
    And the v1 release docs describe Cloudflare Sandbox and Pi runtime setup
    And the v1 release docs describe Workers AI model configuration
    And the v1 release docs forbid request-time package installation for the runtime image

  Scenario: Release surface covers the create-session-to-run-task workflow
    Then the v1 web console can create environments, agents, and sessions
    And the v1 web console can send runtime tasks and inspect session events
    Given the Worker app is initialized
    When I request GET "/api/openapi.json"
    And the OpenAPI document should include path "/api/sessions"
    And the OpenAPI path "/api/sessions" should include method "post"
    And the OpenAPI document should include path "/api/sessions/{sessionId}/events"
    And the OpenAPI document should include path "/api/sessions/{sessionId}/events/export"
    And the OpenAPI document should include path "/api/sessions/{sessionId}/events/stream"
    And the OpenAPI document should include path "/api/sessions/{sessionId}/stop"

  Scenario: Release checks cover implemented v1 behavior
    Then v1 release checks include lint, typecheck, unit tests, BDD, Cloudflare tests, and build
    And no external SDK source code is maintained in this repository
    And v1 secret handling stores references and metadata instead of raw secret values
