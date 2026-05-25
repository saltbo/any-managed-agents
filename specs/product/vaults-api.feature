@api @vaults
Feature: Vaults API
  The control plane manages vaults and credential references.

  @implemented
  Scenario: Manage vault credentials
    When the user creates, rotates, lists, reads, or revokes credentials
    Then raw secret values are never returned after creation

  @implemented
  Scenario: Create and list vaults
    Given a signed-in user has access to a project
    When the user creates a vault with display name, description, scope, and metadata
    Then the response includes vault id, status, timestamps, and safe metadata
    When the user lists vaults
    Then the list supports pagination, archived filtering, and project scope

  @implemented
  Scenario: Create a credential
    Given a vault exists
    When the user creates a credential with name, type, secret value, connector binding, and metadata
    Then the response includes credential id, name, type, active version, connector binding, and timestamps
    And the secret value is accepted only in the create or rotate request
    And the response never includes the raw secret value

  @implemented
  Scenario: List and read credential metadata
    Given a vault has credentials
    When the user lists or reads credentials
    Then the response includes names, types, versions, connector bindings, usage references, and timestamps
    And the response exposes only hasSecret or safe reference fields instead of secret values

  @planned
  Scenario: Archive vaults and delete credential versions safely
    Given a vault exists
    When the user archives the vault
    Then the vault is hidden from default lists and cannot be selected for new sessions
    And existing session references remain auditable
    When the user deletes an unused credential version
    Then the operation requires explicit confirmation and audit metadata
