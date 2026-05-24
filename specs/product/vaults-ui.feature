@planned @vaults @ui
Feature: Vaults UI
  Users manage project vaults from the web console.

  Scenario: Browse vaults
    Given a project has vaults
    When the user opens the vaults page
    Then vaults and credential metadata are visible with secret values redacted

  Scenario: Render vault list controls
    Given a project has active and archived vaults
    When the user opens the vaults page
    Then the page shows search, scope filter, archived toggle, pagination, and a deliberate create action
    And each row shows display name, scope, credential count, status, created time, and updated time
    And archived vaults are visually distinct when shown

  Scenario: Create a vault from the vaults page
    When the user starts the create-vault flow
    Then the form captures display name, description, scope, and metadata
    And validation errors appear next to fields
    And successful creation opens the vault detail page
