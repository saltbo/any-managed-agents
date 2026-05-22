@planned @lint @api
Feature: Update body field alignment
  Update request fields match schemas, handlers, and docs.

  Scenario: Validate update field coverage
    When an update request body changes
    Then validation schema, handler mapping, OpenAPI docs, and tests stay aligned

