@security @vaults
Feature: Vaults and secrets
  Projects manage credentials without exposing secret values to clients or logs.

  Background:
    Given a project has a vault

  @planned
  Scenario: Store provider credentials
    When the user stores an API key or provider token
    Then the secret value is stored in Cloudflare Secrets
    And D1 stores only secret metadata and references
    And API responses never include the raw secret value

  @implemented
  Scenario: Attach vaults to an agent session
    Given an agent requires credentials
    When the user creates a session with allowed runtime secret environment references
    Then the runtime receives only approved vault binding references
    And the transcript shows only redacted values

  @planned
  Scenario: Rotate a credential
    When the user rotates a credential
    Then new sessions use the new credential version
    And existing audit records keep the previous credential reference

  @planned
  Scenario: Deny unauthorized vault access
    When a user outside the project requests a vault or credential
    Then the request is rejected
    And no secret metadata is disclosed
