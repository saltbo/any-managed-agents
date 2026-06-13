@providers @models
Feature: Model providers
  The platform supports all configured model providers without binding the product to Anthropic.

  Background:
    Given a project has provider access configured

  @implemented
  Scenario: Use Workers AI as a first-class provider
    When an agent selects a Workers AI model
    Then the runtime calls the Cloudflare Workers AI binding
    And usage is attributed to the project and session

  @implemented
  Scenario: Configure model providers
    When an operator adds Workers AI, Anthropic, OpenAI, OpenAI-compatible, Ollama, or another supported provider
    Then the platform stores provider metadata in D1
    And credentials are stored in Cloudflare Secrets

  @implemented
  Scenario: Route through provider adapters
    When a session requests any configured provider
    Then the runtime uses the provider adapter for that provider
    And usage, errors, and policy decisions are normalized across providers

  @implemented
  Scenario: Dispatch configured provider connection details to the session runtime
    Given a configured provider with a base URL and a vault credential reference
    And an agent selects that configured provider and one of its models
    When the user creates a self-hosted session for that agent
    Then the queued runner work carries the provider base URL in the runtime environment
    And the queued runner work carries the provider credential only as a vault reference
    And the provider credential value is materialized only when a runner leases the work

  @implemented
  Scenario: Enforce provider policy
    Given a team is allowed to use only selected providers and models
    When an agent requests a blocked provider or model
    Then the request is rejected before a model call is started

  @implemented
  Scenario: Track model usage and cost
    When a provider returns token or usage metadata
    Then the platform records usage by organization, project, agent, session, provider, and model

  @implemented
  Scenario: Normalize provider error categories
    When any provider returns authentication, rate limit, overload, invalid model, safety, or network errors
    Then the runtime records a normalized error type
    And user-facing messages are safe and actionable
    And retryable errors include retry metadata when available

  @implemented
  Scenario: Use provider adapters without changing session protocol
    Given an agent uses any supported provider
    When a session sends a runtime message
    Then provider-specific calls happen behind the selected session runtime adapter boundary
    And clients continue to interact through the AMA session endpoint and canonical event protocol

  @implemented
  Scenario: Reject runtime unsupported provider models
    Given an agent selects a provider and model
    And an environment selects a runtime
    When that runtime does not support the exact provider and model
    Then session creation fails before any provider call is started
    And the error envelope identifies the unsupported runtime, provider, and model
    And no runtime fallback or model substitution occurs
