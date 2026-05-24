@planned @providers @models
Feature: Model providers
  The platform supports all configured model providers without binding the product to Anthropic.

  Background:
    Given a project has provider access configured

  Scenario: Use Workers AI as a first-class provider
    When an agent selects a Workers AI model
    Then the runtime calls the Cloudflare Workers AI binding
    And usage is attributed to the project and session

  Scenario: Configure model providers
    When an operator adds Workers AI, Anthropic, OpenAI, OpenAI-compatible, Ollama, or another supported provider
    Then the platform stores provider metadata in D1
    And credentials are stored in Cloudflare Secrets

  Scenario: Route through provider adapters
    When a session requests any configured provider
    Then the runtime uses the provider adapter for that provider
    And usage, errors, and policy decisions are normalized across providers

  Scenario: Enforce provider policy
    Given a team is allowed to use only selected providers and models
    When an agent requests a blocked provider or model
    Then the request is rejected before a model call is started

  Scenario: Track model usage and cost
    When a provider returns token or usage metadata
    Then the platform records usage by organization, project, agent, session, provider, and model

  Scenario: Normalize provider error categories
    When any provider returns authentication, rate limit, overload, invalid model, safety, or network errors
    Then the runtime records a normalized error type
    And user-facing messages are safe and actionable
    And retryable errors include retry metadata when available

  Scenario: Use provider adapters without changing session protocol
    Given an agent uses any supported provider
    When a session sends a runtime task
    Then provider-specific calls happen behind the Pi/provider adapter boundary
    And clients continue to interact through the AMA runtime endpoint or Pi-compatible helpers
