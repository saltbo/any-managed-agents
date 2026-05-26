@ui
Feature: Web console
  Users operate agents through a Cloudflare-native web console.

  @implemented
  Scenario: Navigate the app shell
    Given a signed-in user has access to a project
    When the user opens the console
    Then the sidebar shows agents, sessions, providers, vaults, usage, audit, and settings
    And the current organization and project are visible

  @planned
  Scenario: Create an agent from the console
    Given a signed-in user has access to a project
    When the user completes the agent creation flow
    Then the agent appears in the project agent list
    And the user can create a session by selecting the new agent and an active environment

  @implemented
  Scenario: Inspect a session with the local real UI
    Given the local real UI e2e app is running
    And the browser user creates an environment, an agent, and a session through public APIs
    When the browser user opens the session detail page
    Then the session detail header remains fixed above the transcript
    And the session chat composer remains fixed near the viewport bottom
    And the transcript controls render without overlap
    When the browser user sends a message through the session composer
    Then the transcript renders the runtime response without mocked APIs

  @planned
  Scenario: Inspect a session transcript
    Given a session has messages, tool calls, and sandbox events
    When the user opens the session detail page
    Then the transcript view shows Pi runtime messages as chat turns
    And tool calls render with structured status, input summary, output summary, and duration
    And the debug view shows runtime events with structured details
    And the composer sends normal chat messages instead of a task form

  @planned
  Scenario: Configure providers and policies
    When the user edits provider access or policy settings
    Then the UI validates the change before saving
    And the saved policy affects later sessions
