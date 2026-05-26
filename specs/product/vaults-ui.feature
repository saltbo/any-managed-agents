@vaults @ui
Feature: Vaults UI
  Users manage project vaults from the web console.

  @implemented
  Scenario: Browse vaults
    Given a project has vaults
    When the user opens the vaults page
    Then vaults and credential metadata are visible with secret values redacted

  @implemented
  Scenario: Render vault list controls
    Given a project has vaults
    When the user opens the vaults page
    Then the page shows pagination and a deliberate create action
    And each vault row shows display name, scope, status, created time, and updated time

  @implemented
  Scenario: Create a vault from the vaults page
    When the user starts the create-vault flow
    Then the form captures display name, description, and scope
    And successful creation returns to the browsable vault list with the new row visible
