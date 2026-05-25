@quickstart
Feature: Quickstart
  A developer can create and run a managed agent quickly on Cloudflare.

  @planned
  Scenario: Complete the first-run flow
    Given the developer has deployed the platform on Cloudflare
    When the developer opens the console for the first time
    Then the platform guides them to create a project, select a provider, create an environment, create an agent, and create a session

  @planned
  Scenario: Display the first-run quickstart structure
    Given the developer is signed in for the first time
    When the developer opens quickstart
    Then the page shows a stepper for provider, agent, environment, session, and integration
    And the page starts on a usable workflow rather than a marketing page
    And each completed step shows the API call that was made against the current platform origin
    And incomplete prerequisites are visible before the user starts a runtime session

  @planned
  Scenario: Create an agent from a template or description
    Given the developer is on the agent step
    When the developer chooses a template or describes the agent goal
    Then the platform drafts agent name, instructions, model, tools, and MCP connectors
    And the developer can inspect and edit the draft before creating the agent
    And creating the agent shows the resulting agent id and version

  @planned
  Scenario: Configure the execution environment in quickstart
    Given an agent was created in quickstart
    When the developer chooses unrestricted networking, limited networking, or a custom environment
    Then the platform creates or selects an environment
    And the environment step explains that environments are reusable sandbox templates
    And limited networking captures allowed hosts, MCP access, and package-manager access
    And the environment step must be completed before creating a session

  @planned
  Scenario: Create a session and send the first task
    Given quickstart has an active agent and environment
    When the developer creates a test session with the agent and environment
    Then the platform creates a session and shows its runtime endpoint
    And the preview shows transcript and debug modes
    And the message composer is focused with a safe example prompt
    When the developer sends the prompt
    Then the message is accepted by the Pi runtime
    And session events stream into the preview without a page reload
    And final success or failure remains inspectable in the session detail page

  @planned
  Scenario: Run the default Workers AI agent
    Given Workers AI is available
    When the developer creates an agent with the default model
    Then the agent can respond through the Pi runtime in Cloudflare Sandbox
    And no Anthropic credential is required

  @planned
  Scenario: Add sandbox execution
    Given Cloudflare Sandbox is configured
    When the developer enables sandbox access for the agent
    Then the agent can run an approved command in an isolated sandbox
    And command output is visible in the session debug view

  @planned
  Scenario: Verify deployment health
    When the developer checks deployment health
    Then the control plane health endpoint responds successfully
    And Cloudflare runtime tests can validate D1 and Durable Object bindings

  @planned
  Scenario: Show integration options after a successful session
    Given quickstart has created a session
    When the developer opens the integration step
    Then examples are available for curl, restish, and generated SDKs
    And examples use the current platform origin and /api OpenAPI contract
    And examples use Pi-compatible runtime helpers for live session traffic
    And examples do not include raw secrets or upstream vendor API URLs
