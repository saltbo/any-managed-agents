@planned @oma-aligned @api @vaults
Feature: Vaults API
  The control plane manages vaults and credential references.

  Scenario: Manage vault credentials
    When the user creates, rotates, lists, reads, or revokes credentials
    Then raw secret values are never returned after creation

