Feature: Governance
  Organizations enforce provider, model, tool, MCP, sandbox, and budget rules across
  a project hierarchy. Policies, access rules, and budgets are scoped resources that
  resolve into an effective policy and gate sessions before runtime execution.

  # ── Resolution and enforcement (domain: business rules, cheapest layer) ──

  @governance/policy-hierarchy @domain
  Scenario: Resolve the policy hierarchy most-restrictive-wins
    Given organization, team, and project policies exist
    When the effective policy is resolved for a caller and their team memberships
    Then levels are ordered organization, applicable teams, then project
    And policy objects merge so the most restrictive rule wins across levels
    And the most specific level is reported as the effective source

  @governance/access-rules @domain
  Scenario: Evaluate provider and model access rules
    Given normalized allow and deny access rules exist
    When a provider and model are checked against the rules
    Then a matching deny rule blocks the resource, honoring team scoping
    And a team-allow rule restricts the resource to members of an approved team
    And wildcard scopes collapse to a compact rule view without an empty reason

  @governance/model-budget @domain
  Scenario: Enforce a model budget before provider execution
    Given a project has a budget for a token, cost, session, or time window
    When recorded usage in the matching window would exceed the limit
    Then the call is denied with a budget policy category before provider execution
    And budgets scoped to a different provider or model are skipped

  @governance/sandbox-restrictions @domain
  Scenario: Enforce sandbox networking and command restrictions
    Given a project sets sandbox enablement, network, host, and command policy
    When a runtime sandbox command or network operation is evaluated
    Then a disabled sandbox, blocked host, or blocked command is denied with its rule
    And the session environment network policy further restricts allowed hosts

  # ── Policy management (usecase: validation and scoping branches) ──

  @governance/policy-create @usecase
  Scenario: Create a scoped governance policy
    Given an organization admin is authenticated
    When the admin creates a tool, MCP, or sandbox policy for a scope
    Then the policy is stored for that scope after scope validation
    And a duplicate scope is rejected with the existing policy id

  @governance/policy-replace @usecase
  Scenario: Replace a policy document while keeping its scope immutable
    Given a policy exists at a scope
    When the admin replaces the policy document
    Then omitted policy objects reset and present objects are applied
    And changing the scope is rejected as immutable

  @governance/access-rule-update @usecase
  Scenario: Update a provider and model access rule
    Given an access rule exists with an effect and reason
    When the admin updates the rule
    Then present fields override and absent fields keep their stored value
    And the reason clears only when explicitly set to null

  @governance/budget-create @usecase
  Scenario: Create a budget with scope validation
    Given project budgets are enabled
    When the admin creates a project, provider, or model budget
    Then the budget is stored after scope validation
    And a provider or model budget without its identifier is rejected

  @governance/budget-update @usecase
  Scenario: Update a budget by merging present fields
    Given a budget exists
    When the admin patches some budget fields
    Then present fields are merged and the rest are preserved

  @governance/effective-policy @usecase
  Scenario: Read effective policy with an optional provider and model decision
    Given organization, team, and project policies, access rules, and budgets exist
    When the admin reads effective policy, optionally for a provider and model
    Then access rules split into provider and model views and enabled budgets are listed
    And a provider-and-model request attaches a decision and audits the evaluation
    And the policy can be resolved as a member of a requested team

  # ── API contract (api: assembled server, tenancy, validation) ──

  @governance/policy-api @api
  Scenario: Manage policies through the control plane
    Given a signed-in admin
    When the admin drives the policies API end to end
    Then create, list, read, replace, and delete are supported with pagination
    And duplicate scopes return conflict and invalid team scopes return validation errors
    And responses never expose the organization id

  @governance/access-rule-api @api
  Scenario: Manage provider and model access rules through the control plane
    Given a signed-in admin
    When the admin creates wildcard and team-scoped rules and edits them
    Then effect, reason, and metadata update and a cleared reason is null
    And deleting a rule removes it and later reads return not found

  @governance/budget-api @api
  Scenario: Manage budgets through the control plane
    Given a signed-in admin
    When the admin creates, reads, lists, patches, and deletes budgets
    Then budgets default to enabled and never expose a status field
    And provider- and model-scoped budgets require their identifier

  @governance/effective-policy-api @api
  Scenario: Read effective policy and policy decisions through the control plane
    Given a signed-in admin with policies, access rules, and budgets configured
    When the admin reads effective policy and requests a provider and model decision
    Then merged policy, access rules, provider rules, and enabled budgets are returned
    And a denied decision is explained by policy category and safe rule reference
    And the denial writes a safe audit record with no secret values
    And providerId or modelId on their own are rejected

  @governance/policy-change-current @api
  Scenario: New policy applies to later effective resolution
    Given a session was created under an older policy
    When governance policy changes
    Then later effective-policy resolution reflects the current policy and team scope
    And historical policy records are not rewritten in place
