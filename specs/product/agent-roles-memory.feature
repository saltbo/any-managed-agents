@api @agents @memory @handoff
Feature: Agent roles, handoff, and memory
  Agent definitions can describe durable responsibilities, delegation rules, and
  whether sessions should receive project-scoped agent memory.

  @implemented
  Scenario: Agent definitions expose role and handoff capability
    Given a project needs agents with different responsibilities
    When the user creates an agent definition with a role, capability tags, and handoff policy
    Then AMA stores those fields as standard agent definition configuration
    And the current agent version snapshots the role, capability tags, and handoff policy
    And sessions created from the agent include those fields in the immutable agent snapshot
    And the fields are available through OpenAPI and generated SDKs

  @implemented
  Scenario: Handoff policy is generic and product-agnostic
    Given an agent definition can hand work to another agent by role or capability
    When a runtime session requests a handoff target
    Then AMA resolves candidates inside the same project scope
    And AMA does not require any product-specific task, board, review, or issue model
    And the requesting product decides how the handoff affects its own workflow records

  @implemented
  Scenario: Agent memory can be enabled per agent definition
    Given a project has long-running maintainer or lead agents
    When the user enables agent memory for an agent definition
    Then AMA provides project-scoped memory through the agent memory API
    And scheduled trigger sessions can reference the same agent memory API
    And pure worker agents can leave memory disabled
    And the memory contract is exposed through OpenAPI and generated SDKs

  @implemented
  Scenario: Agent memory remains AMA runtime state
    Given an external product uses AMA for scheduled agent sessions
    When the agent records notes, decisions, or follow-up context in memory
    Then AMA stores that memory as generic agent runtime state through the agent memory API
    And external products can link to or summarize memory through AMA ids and API responses
    And AMA does not store external product workflow semantics inside memory schema fields
