@planned @cli
Feature: CLI client
  Restish acts as the CLI client for AMA control-plane resources.

  Scenario: Use restish with API credentials
    Given an operator has API credentials
    When the operator calls AMA through restish
    Then restish uses the API base URL, OpenAPI document, and security schemes documented by AMA
    And the operator can request JSON output for automation
    And command failures surface the platform's standard error envelope

  Scenario: Avoid vendor API defaults
    When examples show terminal usage
    Then they point at the user's AMA deployment origin
    And they do not point at Anthropic, OpenAI, or other provider API URLs for control-plane operations
