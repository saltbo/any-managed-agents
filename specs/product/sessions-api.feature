@api @sessions @implemented
Feature: Sessions API
  The control plane exposes APIs for session lifecycle and metadata.

  Scenario: Manage sessions through the API
    Then the sessions API supports create, list, read, reconnect, stop, archive, and events
    And the sessions API enforces auth, project tenancy, and immutable snapshots
    And inactive session runtime requests use the standard error envelope
