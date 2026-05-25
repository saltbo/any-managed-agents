# E2E Harness Split

AMA keeps production runtime regression coverage separate from UI journey
coverage. The split prevents the production smoke from owning every browser
flow and keeps future UI expansion scoped to a journey spec.

## Production Regression Harness

`npm run e2e:production` remains the API-created-resource production smoke.

- Setup: authenticate against `AMA_ORIGIN`, create an environment, agent, and
  session through public AMA `/api` routes, then open the created session in the
  browser.
- Assertions: verify authenticated access, runtime readiness, 20 sequential chat
  turns, tool rendering, debug error visibility, persisted events, and reconnect
  replay dedupe.
- Required secrets: one auth method: `AMA_E2E_COOKIE`,
  `AMA_E2E_STORAGE_STATE`, or `AMA_E2E_EMAIL` plus `AMA_E2E_PASSWORD`.
- Target origins: deployed staging or production origins only. `AMA_ORIGIN`
  defaults to `https://ama.tftt.cc`.
- Cleanup: archive only the resources created by the run by deleting the
  session, agent, and environment ids captured during setup.

The production harness must not seed auth databases, rely on local fixtures, or
become the owner of UI-driven resource creation coverage.

## UI Journey Harness

UI journey coverage belongs in `specs/product/web-ui.feature` and
`test/bdd/browser-e2e.steps.ts`.

- Setup: start a local Vite server, mock `/api` and runtime WebSocket responses,
  and create resources through visible UI flows.
- Assertions: verify login-adjacent routing assumptions, resource creation
  controls, session creation, chat interaction, event inspection, stop flows, and
  desktop plus 390px mobile layout behavior.
- Required secrets: none. UI journey tests use mocked authenticated API
  responses and do not call FlareAuth or deployed AMA origins.
- Target origins: local test server only.
- Cleanup: close Playwright pages, browser contexts, and the local Vite server;
  in-memory mocked resources are discarded with the test state.

Future work that needs actual login UI against FlareAuth should add a dedicated
UI journey spec and command rather than expanding `npm run e2e:production`.
