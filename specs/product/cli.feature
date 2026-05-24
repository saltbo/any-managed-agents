@cli @implemented
Feature: CLI
  Command-line automation uses restish over the published OpenAPI document.

  Scenario: Configure restish for an AMA deployment
    Given an authenticated operator has an AMA deployment URL and API credentials
    When the operator configures restish with the platform OpenAPI document
    Then restish discovers control-plane operations from /api/openapi.json
    And requests are authenticated with the documented auth scheme
    And all operations are scoped to the selected organization and project by API policy

  Scenario: Manage resources through restish-discovered operations
    When the operator uses restish to manage agents, environments, sessions, providers, vaults, governance, usage, or audit records
    Then restish sends standard HTTP requests described by OpenAPI
    And output is derived from documented response schemas
    And no bespoke AMA CLI command implementation is required

  Scenario: Keep runtime interaction Pi-compatible
    Given a session exists
    When the operator sends runtime work from a terminal
    Then the operator uses documented AMA runtime endpoints or Pi-compatible helpers
    And restish remains a control-plane CLI path, not a replacement runtime protocol
