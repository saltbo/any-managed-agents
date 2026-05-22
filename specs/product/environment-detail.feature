@planned @ui @environments
Feature: Environment detail
  Users inspect reusable sandbox environment configuration.

  Scenario: View environment detail
    Given an environment exists
    When the user opens the environment detail page
    Then packages, variables, network policy, versions, and related agents are visible

