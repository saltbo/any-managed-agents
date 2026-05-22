# Any Managed Agents Development Guide

## Clean-Room Boundary

- Do not copy code, specs, UI text, database schemas, or implementation details from AGPL projects.
- Use Cloudflare documentation, public product behavior, and locally authored specs as inputs.
- Keep this project under Apache-2.0-compatible dependencies unless explicitly reviewed.

## Workflow: Executable Specs First

1. Write or update a Gherkin scenario in `specs/product/`.
2. Add or update step definitions in `test/bdd/`.
3. Implement the Worker, Agent, D1, or UI behavior.
4. Run the smallest meaningful check:
   - `npm run bdd`
   - `npm run typecheck`
   - `npm run test`

Scenarios should describe business behavior. Selectors, fixtures, and platform details belong in step definitions and helpers.
