import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Given, Then, When } from '@cucumber/cucumber'

const completedChecks = new Set<string>()

function read(path: string) {
  return readFileSync(path, 'utf8')
}

function assertIncludes(path: string, ...patterns: RegExp[]) {
  const content = read(path)
  for (const pattern of patterns) {
    assert.match(content, pattern, `${path} should match ${pattern}`)
  }
}

function runCheck(name: string, args: string[]) {
  if (completedChecks.has(name)) {
    return
  }

  try {
    execFileSync('npm', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    })
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string; message?: string }
    throw new Error(
      [`Executable check failed: npm ${args.join(' ')}`, output.stdout, output.stderr, output.message]
        .filter(Boolean)
        .join('\n'),
    )
  }

  completedChecks.add(name)
}

function runCloudflareRouteTest(path: string) {
  runCheck(`cf:${path}`, ['run', 'test:cf', '--', path])
}

function runUnitTest(path: string) {
  runCheck(`unit:${path}`, ['test', '--', path])
}

Given('FlareAuth can issue a valid user session', () => {
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

Given('a signed-in user has access to a project', () => {
  runUnitTest('src/App.test.tsx')
})

Given('a project has an active agent definition', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a project has an active environment', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Given('a project has an active model provider', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Given('an agent exists with version 1', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Given('an agent has instructions, description, model config, tools, sandbox policy, and metadata', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Given('a project has active and archived agents created across multiple dates', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Given('an agent exists with existing sessions', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Given('an agent has active sessions', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a project has active and archived environments created across multiple dates', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Given('an environment is used by existing sessions', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('an environment is archived', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Given('a session exists', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a session has many events', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a provider, tool, MCP connector, vault, or sandbox process emits sensitive values', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('more resources exist than fit on one page', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a list route supports timestamps', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a session is running', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a session is idle', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the user requests their auth context', () => {
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

When('a user completes the FlareAuth OIDC callback', () => {
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

When('the user opens the login page', () => {
  runUnitTest('src/App.test.tsx')
})

When('the user opens the console', () => {
  runUnitTest('src/App.test.tsx')
})

When('the user creates a session with an agent and environment', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the client connects through an external SDK session helper or direct runtime client', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the user stops the session', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the user reconnects to the session', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the runtime emits a message, tool, sandbox, policy, usage, or error event', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the client requests events from the API', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the client lists events with limit, order, type filter, or cursor', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the event is stored or streamed', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the API client requests the next page', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the API client requests a date range', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('the user creates an agent with a name and instructions', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When(
  'the user creates an agent with instructions, provider, model, allowed tools, MCP connectors, sandbox policy, and metadata',
  () => {
    runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  },
)

When('the user changes instructions, model config, tools, MCP connectors, sandbox policy, or metadata', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user changes runtime-relevant configuration', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user updates only the description', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user sets a metadata key to null', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user sends an empty tools array', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user lists agents with a page size', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user archives the agent', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user creates an environment with only a name', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

When(
  'the user creates an environment with package requirements, variables, secret references, allowed outbound hosts, MCP access rules, package-manager access rules, resource limits, runtime image, and metadata',
  () => {
    runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  },
)

When(
  'the user changes packages, variables, secret references, network policy, resource limits, runtime image, or metadata',
  () => {
    runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  },
)

When('the user creates an agent or session that references the archived environment', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

When('the user lists environments with a page size', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

When('web UI calls control-plane routes', () => {
  runUnitTest('src/lib/api.test.ts')
})

When('a request schema changes', () => {
  runUnitTest('server/routes/api-contracts.test.ts')
})

When('an update request body changes', () => {
  runUnitTest('server/routes/api-contracts.test.ts')
})

When('a control-plane route changes', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Given('a scenario test is defined', () => {
  assertIncludes('package.json', /"bdd":/, /cucumber-js/)
})

When('CI executes the scenario', () => {
  assertIncludes('package.json', /"bdd":/, /not @planned and not @e2e/, /"bdd:e2e":/)
})

When('a developer requests API documentation', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('the request context includes user, organization, project, roles, and permissions', () => {
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

Then('protected APIs reject missing or invalid sessions with the standard error envelope', () => {
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

Then('the platform creates an httpOnly session and resolves user, organization, and project context', () => {
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

Then('invalid FlareAuth callbacks return the standard OIDC error envelope', () => {
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

Then('the page offers FlareAuth sign-in and preserves the requested return path', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the agents API supports create, read, update, version history, archive, and list', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the agents API enforces auth, project tenancy, model policy, tool policy, and environment availability', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the agents API enforces auth, project tenancy, model policy, and tool policy', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('agent sessions keep immutable agent and environment snapshots', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the response includes an agent id, current version id, project id, timestamps, and archive state', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the agent defaults to the project default model provider and model', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('optional fields use stable empty values instead of disappearing from the response', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the first agent version stores the instructions, model config, tool policy, sandbox policy, and metadata', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the response echoes the normalized runtime configuration', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then(
  'blocked tools, unavailable models, archived environments, and invalid sandbox policies are rejected with field-level validation details',
  () => {
    runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  },
)

Then(
  'blocked tools, unavailable models, and invalid sandbox policies are rejected with field-level validation details',
  () => {
    runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  },
)

Then('secret material is never accepted directly inside agent metadata, tools, or connector configuration', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the platform creates version 2', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('the current agent points at version 2', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('sessions created before the update keep the version 1 snapshot', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('sessions created after the update use the version 2 snapshot', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('every omitted runtime field remains unchanged', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('that key is removed while other metadata keys remain', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the agent version stores an explicit empty tools policy', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the response includes data, hasMore, firstId, and lastId', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('the event is stored with stable ordering and safe metadata', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then("events are returned in sequence order and scoped to the caller's project", () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the response returns a deterministic page', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('hasMore, firstId, lastId, and sequence boundaries allow stable pagination', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('secret values are replaced with safe references', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('audit metadata records the source without exposing the secret', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('archived agents are hidden unless includeArchived is true', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('created date filters only return agents in the requested range', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('results are scoped to the signed-in project', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('the agent is hidden from default lists and creation flows', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('new sessions cannot be created from the archived agent', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('existing sessions and immutable snapshots remain readable', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the archive operation records an audit event', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the environments API supports create, read, update, version history, archive, and list', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('the environments API enforces auth and project tenancy', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('environment secret handling stores references and never returns raw secret values', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('the response includes an environment id, current version id, project id, timestamps, and archive state', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then(
  'package lists, variables, secret references, network policy, resource limits, runtime image, and metadata have stable default values',
  () => {
    runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  },
)

Then('the environment is stored as a reusable definition, not as a running sandbox instance', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('the response stores normalized policy fields', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('raw secret values are rejected', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('secret references are returned only as safe names and references', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then(
  'invalid package specs, invalid host patterns, and unsupported runtime images return field-level validation details',
  () => {
    runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  },
)

Then('the platform creates a new environment version', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('existing sessions keep their original environment snapshot', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('new sessions that reference the environment use the new environment version', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the request is rejected with a conflict error', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the archived environment remains readable through explicit read and includeArchived list requests', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('archived environments are hidden unless includeArchived is true', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Then('created date filters only return environments in the requested range', () => {
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
})

Given('a project has a vault', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Given('a vault exists', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Given('a vault has credentials', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user creates, rotates, lists, reads, or revokes credentials', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user creates a vault with display name, description, scope, and metadata', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user lists vaults', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user creates a credential with name, type, secret value, connector binding, and metadata', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user lists or reads credentials', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user archives the vault', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user deletes an unused credential version', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user stores an API key or provider token', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('the user rotates a credential', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

When('a user outside the project requests a vault or credential', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('raw secret values are never returned after creation', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the response includes vault id, status, timestamps, and safe metadata', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the list supports pagination, archived filtering, and project scope', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the response includes credential id, name, type, active version, connector binding, and timestamps', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the secret value is accepted only in the create or rotate request', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the response never includes the raw secret value', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('API responses never include the raw secret value', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the response includes names, types, versions, connector bindings, usage references, and timestamps', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the response exposes only hasSecret or safe reference fields instead of secret values', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the vault is hidden from default lists and cannot be selected for new sessions', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('existing session references remain auditable', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the operation requires explicit confirmation and audit metadata', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the secret value is stored in Cloudflare Secrets', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('D1 stores only secret metadata and references', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('new sessions use the new credential version', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('existing audit records keep the previous credential reference', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the request is rejected', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('no secret metadata is disclosed', () => {
  runCloudflareRouteTest('server/routes/vaults.cf-test.ts')
})

Then('the sessions API supports create, list, read, reconnect, stop, archive, and events', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the sessions API enforces auth, project tenancy, and immutable snapshots', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('inactive session runtime requests use the standard error envelope', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the platform stores a session record in D1', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the session uses a snapshot of the selected agent version', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('a new agent version is created and active sessions keep their original snapshot', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the session uses a snapshot of the selected environment', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the session records its sandbox id, Pi session or runtime id, and status', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('runtime traffic uses Pi protocol or a transparent AMA proxy around Pi protocol', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the helper does not define an incompatible replacement runtime protocol', () => {
  assertIncludes('docs/product/spec.md', /AMA must proxy or adapt Pi protocol/)
})

Then('AMA requests the Pi bridge to stop', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the session status becomes stopped', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('lifecycle events record the stop', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('session metadata, sandbox state references, runtime endpoint, and status are available', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the document describes control-plane routes, schemas, auth, errors, and pagination', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('the API uses stable cursor metadata', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
  runUnitTest('src/lib/api.test.ts')
})

Then('only matching resources are returned', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
  runUnitTest('src/lib/api.test.ts')
})

Then('requests use shared auth, error handling, tenancy headers, and response parsing', () => {
  runUnitTest('src/lib/api.test.ts')
})

Then('the route handler, tests, and OpenAPI contract are updated together', () => {
  runUnitTest('server/routes/api-contracts.test.ts')
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('validation schema, handler mapping, OpenAPI docs, and tests stay aligned', () => {
  runUnitTest('server/routes/api-contracts.test.ts')
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('tests cover validation, auth, tenancy, success, and error paths', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
  runCloudflareRouteTest('server/routes/auth.cf-test.ts')
})

Then('tests cover OpenAPI route schema alignment', () => {
  runUnitTest('server/routes/api-contracts.test.ts')
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('Cloudflare route tests cover the v1 runtime proxy and session events', () => {
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('the test verifies user-visible behavior and runtime side effects', () => {
  runUnitTest('src/App.test.tsx')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('implemented product scenarios are not excluded with planned tags', () => {
  assertIncludes('specs/product/web-ui.feature', /@implemented @e2e\n\s+Scenario: Complete the v1/)
  assertIncludes('specs/product/server-tests.feature', /@testing @implemented/)
  assertIncludes('specs/product/scenario-tests.feature', /@testing @implemented/)
})

Then('mocked browser scenario evidence covers desktop and 390px mobile workflows', () => {
  assertIncludes(
    'test/bdd/browser-e2e.steps.ts',
    /width: 1280, height: 900/,
    /width: 390, height: 844/,
    /Create environment/,
    /Send/,
  )
})

Then('the production e2e command documents the required secret environment variables', () => {
  assertIncludes('package.json', /"e2e:production":\s*"playwright test --config playwright\.production\.config\.ts"/)
  assertIncludes(
    'README.md',
    /AMA_ORIGIN/,
    /AMA_E2E_STORAGE_STATE/,
    /AMA_E2E_COOKIE/,
    /AMA_E2E_EMAIL/,
    /AMA_E2E_PASSWORD/,
    /npm run e2e:production/,
    /Auth input precedence/,
  )
  assertIncludes(
    'docs/infra/cloudflare-deploy.md',
    /Remote regression smoke/,
    /AMA_ORIGIN/,
    /AMA_E2E_STORAGE_STATE/,
    /AMA_E2E_COOKIE/,
    /AMA_E2E_EMAIL/,
    /AMA_E2E_PASSWORD/,
    /Auth input precedence/,
  )
  assertIncludes('.gitignore', /\.secrets\//)
})

Then('the production e2e harness authenticates without direct auth database access', () => {
  const content = read('test/e2e/production-regression.spec.ts')
  assert.match(content, /Continue with FlareAuth|AMA_E2E_STORAGE_STATE|AMA_E2E_COOKIE/)
  assert.doesNotMatch(content, /wrangler\s+d1|INSERT INTO|app_sessions|seedLocalAuth/)
})

Then('the production e2e harness creates resources through public AMA APIs', () => {
  assertIncludes('test/e2e/production-regression.spec.ts', /\/api\/environments/, /\/api\/agents/, /\/api\/sessions/)
})

Then('the production e2e harness verifies runtime chat, tool rendering, debug errors, and replay dedupe', () => {
  assertIncludes(
    'test/e2e/production-regression.spec.ts',
    /turn <= 20/,
    /sandbox\.exec/,
    /Debug/,
    /assertNoDuplicateReplayAfterReconnect/,
    /assertNoDuplicatePersistedEvents/,
  )
})

Then('the OpenAPI document is generated from Hono route schemas for v1 resources', () => {
  assertIncludes('server/app.ts', /app\.doc\('\/api\/openapi\.json'/)
  assertIncludes('server/routes/agents.ts', /createRoute/, /app\.openapi/)
  assertIncludes('server/routes/environments.ts', /createRoute/, /app\.openapi/)
  assertIncludes('server/routes/sessions.ts', /createRoute/, /app\.openapi/)
  assertIncludes('server/routes/vaults.ts', /createRoute/, /app\.openapi/)
})

Then('the v1 console supports creating environments, agents, and sessions', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the v1 console uses URL routes for primary resources', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the v1 console is built from the project component library primitives', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the v1 console separates routing, forms, views, and shared UI components', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the v1 console keeps browsing resources as the primary screen', () => {
  runUnitTest('src/App.test.tsx')
})

Then('creation is a deliberate flow instead of always-on side panels', () => {
  runUnitTest('src/App.test.tsx')
})

Then('mobile navigation labels remain readable without truncation', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the v1 console supports sending runtime messages and inspecting session events', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the sidebar shows agents, sessions, providers, vaults, usage, audit, and settings', () => {
  runUnitTest('src/App.test.tsx')
})

Then('the current organization and project are visible', () => {
  runUnitTest('src/App.test.tsx')
})
