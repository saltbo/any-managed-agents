@planned @providers @models
Feature: Model providers
  The platform supports multiple model providers without binding the product to Anthropic.

  Background:
    Given a project has provider access configured

  Scenario: Use Workers AI as a first-class provider
    When an agent selects a Workers AI model
    Then the runtime calls the Cloudflare Workers AI binding
    And usage is attributed to the project and session

  Scenario: Configure external model providers
    When an operator adds an OpenAI-compatible or Anthropic provider
    Then the platform stores provider metadata in D1
    And credentials are stored as secrets or vault references

  Scenario: Enforce provider policy
    Given a team is allowed to use only selected providers and models
    When an agent requests a blocked provider or model
    Then the request is rejected before a model call is started

  Scenario: Track model usage and cost
    When a provider returns token or usage metadata
    Then the platform records usage by organization, project, agent, session, provider, and model
