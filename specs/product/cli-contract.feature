@planned @cli
Feature: CLI contract
  The OpenAPI document is the CLI contract for restish automation.

  Scenario: Expose stable operation metadata
    When the OpenAPI document is generated
    Then each control-plane operation has operationId, tags, summary, parameters, requestBody, responses, and security metadata
    And operation ids remain stable unless a versioned API change is made
    And restish can map operations without custom command definitions

  Scenario: Emit machine-readable output through restish
    When a restish command is run with JSON output
    Then the response shape matches the documented OpenAPI response schema
    And error responses match the standard error envelope

  Scenario: Validate route-method alignment for restish
    When the API exposes archive, delete, stop, rotate, revoke, or connect operations
    Then the OpenAPI document describes the exact HTTP method and path used by the server
    And destructive operations are not ambiguous between archive and permanent delete
