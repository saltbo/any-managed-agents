@planned @oma-aligned @api @sessions
Feature: Sessions API
  The control plane exposes APIs for session lifecycle and metadata.

  Scenario: Manage sessions through the API
    When the user creates, lists, reads, stops, archives, or resumes a session
    Then the API enforces auth, tenancy, and agent snapshot rules

