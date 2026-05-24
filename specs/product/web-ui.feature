@ui
Feature: Web console
  Users operate agents through a Cloudflare-native web console.

  Background:
    Given a signed-in user has access to a project

  @implemented @e2e
  Scenario: Complete the v1 create-session-to-chat workflow
    When the user opens the console
    Then the v1 console uses URL routes for primary resources
    And the v1 console is built from the project component library primitives
    And the v1 console separates routing, forms, views, and shared UI components
    And the v1 console keeps browsing resources as the primary screen
    And creation is a deliberate flow instead of always-on side panels
    And mobile navigation labels remain readable without truncation
    And the v1 console supports creating environments, agents, and sessions
    And the v1 console supports sending runtime messages and inspecting session events
    And a browser verifies the v1 create-session-to-chat UI workflow with mocked API responses on desktop and mobile

  @implemented
  Scenario: Navigate the app shell
    When the user opens the console
    Then the sidebar shows agents, sessions, providers, vaults, usage, audit, and settings
    And the current organization and project are visible

  @planned
  Scenario: Create an agent from the console
    When the user completes the agent creation flow
    Then the agent appears in the project agent list
    And the user can create a session by selecting the new agent and an active environment

  @implemented
  Scenario: Inspect a session
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
