@runtime @sessions @implemented
Feature: Agent sessions
  A session is a tenant-scoped run of a specific agent version.

  Background:
    Given a project has an active agent definition

  Scenario: Start a session from an agent
    When the user starts a session
    Then the platform stores a session record in D1
    And the session uses a snapshot of the selected agent version
    And the session uses a snapshot of the selected environment
    And the session records its sandbox id, Pi session or runtime id, and status

  Scenario: Connect to a session with Pi protocol
    Given a session exists
    When the client connects through an external SDK session helper or direct runtime client
    Then runtime traffic uses Pi protocol or a transparent AMA proxy around Pi protocol
    And the helper does not define an incompatible replacement runtime protocol

  Scenario: Stop a running session
    Given a session is running
    When the user stops the session
    Then AMA requests the Pi bridge to stop
    And the session status becomes stopped
    And lifecycle events record the stop

  Scenario: Resume an idle session
    Given a session is idle
    When the user reconnects to the session
    Then session metadata, sandbox state references, runtime endpoint, and status are available
