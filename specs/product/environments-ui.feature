@ui @environments
Feature: Environments UI
  Users manage sandbox environments from the web console.

  @planned
  Scenario: Browse environments
    Given a project has environments
    When the user opens the environments page
    Then the user can search, filter, create, edit, archive, and inspect environments

  @implemented
  Scenario: Render the empty environments page
    Given the project has no environments
    When the user opens the environments page
    Then the page shows the Environments heading and a deliberate create action
    And the empty state explains that environments are reusable sandbox templates, not running containers

  @implemented
  Scenario: Render the environments table
    Given a project has environments
    When the user opens the environments page
    Then each environment row shows name, status, hostingMode, runtime, runtimeConfig, packages, network policy, and updated time
    And clicking a row opens the environment detail route

  @implemented
  Scenario: Create an environment from the environments page
    When the user starts the create-environment flow
    Then the form captures name, hostingMode, runtime, runtimeConfig, network mode, allowed hosts, package requirements, and variables
    And successful save creates an environment version and returns to the browsable environments list
