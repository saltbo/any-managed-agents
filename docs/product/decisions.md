# Product Decisions

These decisions define the intended end state for Any Managed Agents.

## Environment and Sandbox

- `Environment` is a long-lived description of an execution environment.
- `Sandbox` is a runtime instance created from an environment snapshot.
- Each running `Session` owns exactly one sandbox.
- Sandbox instances follow the session lifecycle and are not reused across sessions.
- Sandbox instances are execution environments only and must not expose public ports or preview URLs.

## SDK Ownership

- This repository does not maintain SDK source code.
- This repository publishes the control-plane OpenAPI document.
- TypeScript, Python, Go, and other SDKs should live in separate repositories.
- External SDKs must be generated from or mechanically aligned with this repository's OpenAPI document.
- Runtime helpers in external SDKs must delegate to Cloudflare Agent SDK-compatible endpoints.

## Authentication

- Authentication integrates with FlareAuth.
- This project must not reimplement a parallel authentication system.
- Control-plane and runtime requests resolve tenant context from FlareAuth sessions or credentials.

## Providers

- Workers AI is first-class.
- All configured providers should be supported through provider adapters.
- Provider behavior should be normalized for usage, policy, errors, and audit records.

## Secrets

- Secret values are stored in Cloudflare Secrets.
- D1 stores metadata and references only.
- API responses, events, logs, and UI views must not expose raw secret values.

## Specs

- Gherkin is the product spec format.
- Cucumber is the executable spec runner.
- E2E specs use Cucumber step definitions backed by Playwright.

