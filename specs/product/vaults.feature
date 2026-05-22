@planned @vaults
Feature: Vaults
  Vaults provide scoped access to credentials.

  Scenario: Resolve credential for runtime
    Given a session is allowed to use a vault credential
    When runtime needs the credential
    Then it resolves a safe secret reference without exposing the value to clients

