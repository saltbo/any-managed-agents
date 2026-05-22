@planned @cli
Feature: CLI
  A CLI may automate control-plane operations without becoming a runtime SDK.

  Scenario: Manage project resources through the control-plane API
    Given an authenticated operator
    When the operator uses CLI resource commands
    Then all commands are scoped to the selected organization and project
    And agent runtime interaction remains Cloudflare Agent SDK-compatible
