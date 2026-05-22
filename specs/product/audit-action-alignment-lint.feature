@planned @oma-aligned @lint @audit
Feature: Audit action alignment lint
  Audit action names stay aligned across server, UI, and specs.

  Scenario: Validate audit action naming
    When audit actions are added
    Then action identifiers are stable, documented, and represented consistently in audit views

