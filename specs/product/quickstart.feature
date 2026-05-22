@planned @quickstart
Feature: Quickstart
  A developer can create and run a managed agent quickly on Cloudflare.

  Scenario: Complete the first-run flow
    Given the developer has deployed the platform on Cloudflare
    When the developer opens the console for the first time
    Then the platform guides them to create a project, select a provider, create an agent, and start a session

  Scenario: Run the default Workers AI agent
    Given Workers AI is available
    When the developer creates an agent with the default model
    Then the agent can respond through the Cloudflare Agent SDK runtime
    And no Anthropic credential is required

  Scenario: Add sandbox execution
    Given Cloudflare Sandbox SDK is configured
    When the developer enables sandbox access for the agent
    Then the agent can run an approved command in an isolated sandbox
    And command output is visible in the session debug view

  Scenario: Verify deployment health
    When the developer checks deployment health
    Then the control plane health endpoint responds successfully
    And Cloudflare runtime tests can validate D1 and Durable Object bindings
