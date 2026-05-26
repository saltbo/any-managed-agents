@api @schedules
Feature: Scheduled agent triggers
  Heartbeat-driven schedules can wake agents by creating sessions with initial prompts.

  @implemented
  Scenario: Heartbeat dispatch creates one scheduled session per due occurrence
    Given a project has an active agent and active environments
    When the user creates a due scheduled agent trigger
    And the local heartbeat dispatcher runs twice for the same occurrence
    Then one scheduled run creates a session with the initial prompt and correlation metadata
    And duplicate heartbeat dispatch does not create another session for the same occurrence
    And scheduled trigger dispatch is recorded in audit history

  @implemented
  Scenario: Inactive scheduled triggers do not run
    Given a project has an active agent and active environments
    When the user creates paused and archived scheduled agent triggers
    And the local heartbeat dispatcher runs
    Then inactive scheduled triggers have no run history
