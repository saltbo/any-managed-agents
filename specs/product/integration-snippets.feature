@planned @docs
Feature: Integration snippets
  Developers can copy minimal examples for SDK and API usage.

  Scenario: Show OpenAPI and external SDK snippets
    When a developer views integration docs
    Then examples create agents, environments, and sessions with the control-plane API or external SDKs
    And examples connect to session runtime through Pi-compatible helpers
    And examples do not expose raw Cloudflare Sandbox usage as the primary product interface
