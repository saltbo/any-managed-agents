@vaults @ui
Feature: Vault detail
  Users inspect vault metadata without exposing secrets.

  @implemented
  Scenario: View vault detail
    Given a vault exists
    When the user opens vault detail
    Then credential names, versions, usage references, and audit history are visible without raw secret values

  @implemented
  Scenario: Render vault loading, empty, and archived states
    Given the vault detail request is loading
    Then the page shows a loading state using shared UI primitives
    When the vault has no credentials
    Then the credential table shows an empty state and a create action
    When the vault is archived
    Then destructive and create actions are hidden or disabled
    And credential metadata remains readable for audit

  @implemented
  Scenario: Add a credential from vault detail
    Given the vault is active
    When the user opens the add credential dialog
    Then name, type, connector binding, secret value, and metadata inputs are shown
    And the secret input uses a password-style control
    And save is disabled until required fields are valid
    When the user saves
    Then the dialog closes, the credential list refetches, and the secret value is not rendered

  @implemented
  Scenario: Rotate and revoke credentials from vault detail
    Given a credential exists
    When the user rotates it
    Then a new credential version appears in metadata
    And the old secret value is not displayed
    When the user revokes it and confirms
    Then the credential status becomes revoked and future runtime resolution is blocked
