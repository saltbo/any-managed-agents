@api @integration @external-products
Feature: External products use AMA as the runtime substrate
  Products such as Agent Kanban own product workflow, but use AMA as the
  lower-level agent definition, environment, session, runner, and event layer.

  @implemented
  Scenario: External product maps its agents and execution targets to AMA resources
    Given an external product has its own agent profile and execution target ids
    When the external product creates or updates the corresponding AMA resources
    Then AMA stores the agent definition with the external product reference metadata
    And AMA stores the environment with the external product reference metadata
    And repeated requests with the same external references update the same AMA resources
    And AMA does not require the external product to expose board, task, review, or PR concepts

  @implemented
  Scenario: External product starts task work by creating an AMA session
    Given an external product has mapped an agent profile to an AMA agent definition
    And the external product has mapped an execution target to an AMA environment
    When the external product creates an AMA session with its task correlation metadata
    Then AMA snapshots the selected agent and environment
    And AMA validates the environment runtime, provider, and model before runtime work starts
    And AMA returns a stable session id, status, status reason, runtime, and event endpoint
    And the external product can render progress from AMA session status and canonical events only

  @implemented
  Scenario: External product controls a running session only through AMA endpoints
    Given an external product created an AMA session
    When the external product sends a follow-up message, stop request, or resume request
    Then AMA routes the command to the selected runtime or owning self-hosted runner
    And AMA records the command result as canonical session events
    And the external product never connects to a sandbox-local, runner-local, or official-runtime-local endpoint
