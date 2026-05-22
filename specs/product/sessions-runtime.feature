@planned @runtime @sessions
Feature: Agent sessions
  A session is a tenant-scoped run of a specific agent version.

  Background:
    Given a project has an active agent definition

  Scenario: Start a session from an agent
    When the user starts a session
    Then the platform stores a session record in D1
    And the session is bound to an Agent Durable Object
    And the session uses a snapshot of the selected agent version

  Scenario: Connect to a session with Cloudflare Agent SDK
    Given a session exists
    When the client connects through Cloudflare Agent SDK
    Then runtime traffic is routed through /agents/*
    And the platform does not require a custom runtime client SDK

  Scenario: Stop a running session
    Given a session is running
    When the user stops the session
    Then the Agent Durable Object receives a cancellation signal
    And the session status becomes stopped
    And no additional model calls are started for that session

  Scenario: Resume an idle session
    Given a session is idle
    When the user reconnects to the session
    Then prior messages, tool calls, sandbox state references, and status are available
