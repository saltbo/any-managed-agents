@planned @oma-aligned @agents
Feature: Agent updates
  Agent changes are versioned instead of mutating running sessions.

  Scenario: Update an agent safely
    Given an agent has active sessions
    When the user changes runtime-relevant configuration
    Then a new agent version is created and active sessions keep their original snapshot

