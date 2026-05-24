@planned @docs
Feature: Integration snippets
  Developers can copy minimal examples for SDK and API usage.

  Scenario: Show OpenAPI and external SDK snippets
    When a developer views integration docs
    Then examples create agents, environments, and sessions with the control-plane API or external SDKs
    And examples connect to session runtime through Pi-compatible helpers
    And examples do not expose raw Cloudflare Sandbox usage as the primary product interface

  Scenario: Show restish snippets for control-plane operations
    Given the console is running at a deployment origin
    When a developer views terminal integration examples
    Then snippets show how to configure restish against the current origin's /api/openapi.json
    And snippets show agents, environments, sessions, providers, vaults, governance, usage, and audit examples through restish
    And snippets use the AMA auth scheme and never include raw secrets

  Scenario: Use current origin in snippets
    When the console renders curl, restish, Python, TypeScript, or SDK examples
    Then the base URL is the current AMA deployment origin unless the user overrides it
    And snippets do not reference upstream vendor API hosts for AMA control-plane operations
    And runtime snippets identify when Pi-compatible helpers are more appropriate than generic REST calls
