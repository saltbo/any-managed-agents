@planned @ui @agents
Feature: Agent builder
  Users can configure a managed agent through a guided builder.

  Background:
    Given a signed-in user has access to a project

  Scenario: Configure core agent settings
    When the user opens the agent builder
    Then the builder captures name, description, instructions, model, and default environment
    And required fields are validated before saving

  Scenario: Configure tools and approvals
    When the user adds tools or MCP connectors
    Then the builder shows schemas, approval mode, and policy status
    And blocked tools cannot be saved for the agent

  Scenario: Configure sandbox access
    When the user enables sandbox execution
    Then the builder requires an environment and sandbox policy
    And the resulting agent version can request Cloudflare Sandbox SDK execution

  Scenario: Test an agent before publishing
    Given the user has configured an agent draft
    When the user starts a test session
    Then the draft runs in an isolated session
    And publishing creates a versioned agent definition
