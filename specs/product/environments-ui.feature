@planned @ui @environments
Feature: Environments UI
  Users manage sandbox environments from the web console.

  Scenario: Browse environments
    Given a project has environments
    When the user opens the environments page
    Then the user can search, filter, create, edit, archive, and inspect environments

  Scenario: Render the empty environments page
    Given the project has no environments
    When the user opens the environments page
    Then the page shows the Environments heading and a deliberate create action
    And the page shows search, network policy filter, archived toggle, and pagination controls in disabled or empty states
    And the empty state explains that environments are reusable sandbox templates, not running containers

  Scenario: Render the environments table
    Given the project has active and archived environments
    When the user opens the environments page
    Then each row shows name, status, network policy, runtime image, package summary, created time, and updated time
    And archived rows are visually distinct when the archived filter is enabled
    And clicking a row opens the environment detail route

  Scenario: Create an environment from the environments page
    When the user starts the create-environment flow
    Then the form captures name, package requirements, variables, secret references, network policy, resource limits, runtime image, and metadata
    And raw secret values are rejected before submit
    And successful save creates an environment version and returns to the browsable environments list
