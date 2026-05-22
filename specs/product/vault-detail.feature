@planned @oma-aligned @vaults @ui
Feature: Vault detail
  Users inspect vault metadata without exposing secrets.

  Scenario: View vault detail
    Given a vault exists
    When the user opens vault detail
    Then credential names, versions, usage references, and audit history are visible without raw secret values

