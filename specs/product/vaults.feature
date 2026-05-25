@vaults
Feature: Vaults
  Vaults provide scoped access to credentials.

  @planned
  Scenario: Resolve credential for runtime
    Given a session is allowed to use a vault credential
    When runtime needs the credential
    Then it resolves a safe secret reference without exposing the value to clients

  @planned
  Scenario: Store credentials encrypted at rest
    Given the platform encryption key is configured
    When a user stores a credential in a vault
    Then the persisted value is encrypted with authenticated encryption
    And repeated encryption of the same value produces different ciphertext
    And tampered ciphertext cannot be decrypted successfully
    And plaintext is never written to D1, logs, events, or audit metadata

  @planned
  Scenario: Scope vault credentials to organization and project
    Given two projects exist in different organizations
    When one project stores a credential
    Then users in the other organization cannot list, resolve, rotate, or use that credential
    And cross-project access in the same organization requires explicit policy

  @planned
  Scenario: Rotate a credential without breaking historical auditability
    Given a credential has version 1
    When a user rotates the credential
    Then version 2 becomes the active version for future sessions
    And historical sessions keep safe references to the version they used
    And the old value is no longer returned or exposed

  @planned
  Scenario: Revoke a credential
    Given a credential is active
    When a user revokes it
    Then future sessions cannot resolve it
    And running sessions receive a policy-safe runtime error at the next credential resolution point
    And the revocation records an audit event
