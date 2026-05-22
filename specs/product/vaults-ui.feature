@planned @oma-aligned @vaults @ui
Feature: Vaults UI
  Users manage project vaults from the web console.

  Scenario: Browse vaults
    Given a project has vaults
    When the user opens the vaults page
    Then vaults and credential metadata are visible with secret values redacted

