@planned @ui @environments
Feature: Environments UI
  Users manage sandbox environments from the web console.

  Scenario: Browse environments
    Given a project has environments
    When the user opens the environments page
    Then the user can search, filter, create, edit, archive, and inspect environments

