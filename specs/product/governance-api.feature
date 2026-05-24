@planned @api @governance
Feature: Governance API
  Operators manage governance policy through the control plane.

  Scenario: Update governance policy
    When an operator saves provider, model, tool, sandbox, or budget policy
    Then the platform validates and applies the policy to later sessions

  Scenario: Manage provider and model access policy
    Given an organization admin is authenticated
    When the admin creates or updates provider and model access rules for teams and projects
    Then the response includes normalized allow and deny rules
    And future agent and session creation enforce those rules before runtime startup
    And policy changes are audited with actor, resource, and safe diff metadata

  Scenario: Manage tool, MCP, and sandbox policy
    Given an organization admin is authenticated
    When the admin updates allowed tools, MCP connectors, approval modes, sandbox networking, or command restrictions
    Then future sessions enforce the most restrictive applicable rule
    And blocked runtime actions emit policy events with safe details

  Scenario: Manage budgets through the API
    Given project budgets are enabled
    When the admin sets model, token, session, or time-window budgets
    Then session startup and provider calls check remaining budget before execution
    And budget denials are visible in usage and audit records

  Scenario: Read effective policy for a project
    Given organization, team, project, and agent policies exist
    When the admin requests effective policy
    Then the response explains the resolved rule source for provider, model, tool, MCP, sandbox, and budget decisions
