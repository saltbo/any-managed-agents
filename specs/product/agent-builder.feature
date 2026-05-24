@planned @ui @agents
Feature: Agent builder
  Users can configure a managed agent through a guided builder.

  Background:
    Given a signed-in user has access to a project

  Scenario: Configure core agent settings
    When the user opens the agent builder
    Then the builder captures name, description, instructions, and model
    And required fields are validated before saving

  Scenario: Configure tools and approvals
    When the user adds tools or MCP connectors
    Then the builder shows schemas, approval mode, and policy status
    And blocked tools cannot be saved for the agent

  Scenario: Configure sandbox access
    When the user enables sandbox execution
    Then the builder captures sandbox policy
    And the resulting agent version can request Cloudflare Sandbox execution

  Scenario: Test an agent before publishing
    Given the user has configured an agent draft
    When the user starts a test session
    Then the draft runs in an isolated session
    And publishing creates a versioned agent definition

  Scenario: Build an agent from a guided first-run flow
    When the user describes the agent goal in natural language or picks a template
    Then the builder drafts name, instructions, model choice, tool policy, and MCP connectors
    And the user can inspect and edit the generated configuration before saving
    And the builder asks for one missing decision at a time instead of blocking on a long form

  Scenario: Show API examples for the created agent
    Given the builder has created an agent
    Then the builder shows the equivalent create-agent API call using this platform origin
    And examples use AMA control-plane routes, not upstream vendor API URLs
    And examples never include raw secrets
