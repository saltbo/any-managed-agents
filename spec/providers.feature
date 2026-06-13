Feature: Providers
  Operators configure model providers per project: metadata, safe credential
  references, model catalogs, rate limits, and budget policy. The platform stays
  provider-neutral — Workers AI, Anthropic, OpenAI, OpenAI-compatible, Ollama, and
  others all flow through provider adapters and project access policy.

  # ── Configuration rules (domain: pure validation, no D1) ──

  @providers/credential-status @domain
  Scenario: Classify provider credential requirements by type
    Given a provider type and an optional credential reference
    When the provider credential status is computed
    Then credential-optional types like Workers AI and Ollama report not_required or configured
    And external types like OpenAI and Anthropic report missing until a credential reference is attached

  @providers/base-url @domain
  Scenario: Require a base URL only for OpenAI-compatible providers
    Given a provider type and an optional base URL
    When the base URL is validated
    Then OpenAI-compatible providers without a base URL fail with a field-level error
    And other provider types are accepted without a base URL

  @providers/error-normalization @domain
  Scenario: Normalize provider error categories without leaking credentials
    When any provider returns authentication, rate limit, quota, overload, invalid model, or network errors
    Then the runtime records a stable normalized error type
    And retryable errors include retry metadata when available
    And user-facing messages never echo raw credential material

  @providers/catalog-parse @domain
  Scenario: Parse discovered model catalogs into safe fields only
    Given a provider returns a model listing payload
    When the catalog is parsed
    Then each model stores id, display name, capabilities, context limits, pricing hints, and availability
    And unrecognized payloads are rejected instead of guessed
    And credential-bearing payload fields are never copied into the catalog

  # ── Lifecycle (usecase: business branches over fake ports) ──

  @providers/create @usecase
  Scenario: Configure a provider and reassign the project default
    When an operator adds a provider with metadata, credentials, model catalog, rate limits, and budget policy
    Then it is stored safely with hostingMode-independent settings
    And marking it default clears every other default provider in the same project
    And an OpenAI-compatible provider without a base URL is rejected

  @providers/update @usecase
  Scenario: Update provider configuration and credential references
    Given a project has a provider
    When an operator updates its type or credential reference
    Then switching to OpenAI-compatible without a base URL is rejected
    And clearing the credential reference removes the stored binding without exposing the value

  @providers/delete @usecase
  Scenario: Delete or disable a provider safely
    Given agents or sessions reference a provider
    When an operator deletes a provider still referenced by agents
    Then the request is rejected
    When an operator deletes an unused provider
    Then it no longer appears in provider lists

  @providers/discovery @usecase
  Scenario: Discover provider models safely
    Given a provider is configured
    When model discovery succeeds
    Then every fetched model is upserted and the discovery task is marked succeeded
    And Workers AI discovery materializes the binding default catalog
    When model discovery fails or the provider is unreachable
    Then the task and provider record a normalized error category without leaking credentials
    And existing provider configuration remains readable

  # ── API contract (api: assembled server, tenancy, OpenAPI) ──

  @providers/api-crud @api
  Scenario: Manage providers over the API without exposing credentials
    Given a signed-in user has access to a project
    When the user lists the platform default Workers AI provider and creates, reads, updates, and hard-deletes providers
    Then the v1 schema reports id, type, display name, default status, credential status, model catalog status, and timestamps
    And a single default provider per project is kept
    And raw credential values and internal secret references are never returned
    And providers are isolated between tenants
    And deleting a provider still referenced by agents is rejected

  @providers/api-models @api
  Scenario: Manage and discover provider models over the API
    Given a configured provider exists
    When the user upserts and deletes provider models and runs model discovery as an addressable task
    Then model writes use full-replacement PUT semantics and accept slash-containing model ids
    And discovery runs synchronously as a task resource and records failures without leaking credentials
    And model writes and discovery on the synthesized platform default return 404

  @providers/dispatch @api
  Scenario: Dispatch configured provider connection details to the session runtime
    Given a configured provider with a base URL and a vault credential reference
    And an agent selects that configured provider and one of its models
    When the user creates a self-hosted session for that agent
    Then the queued runner work carries the provider base URL in the runtime environment
    And the provider credential is carried only as a vault reference
    And the credential value is materialized into the runtime env only when a runner leases the work
