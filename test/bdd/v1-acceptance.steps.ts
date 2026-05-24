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

Given('a session exists', () => {
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

When('the user starts a session', () => {
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

When('web UI calls control-plane routes', () => {
  runUnitTest('src/lib/api.test.ts')
})

When('a request schema changes', () => {
  runUnitTest('server/routes/api-contracts.test.ts')
})

When('an update request body changes', () => {
  runUnitTest('server/routes/api-contracts.test.ts')
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

Then('agent sessions keep immutable agent and environment snapshots', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
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

Then('the OpenAPI document is generated from Hono route schemas for v1 resources', () => {
  assertIncludes('server/app.ts', /app\.doc\('\/api\/openapi\.json'/)
  assertIncludes('server/routes/agents.ts', /createRoute/, /app\.openapi/)
  assertIncludes('server/routes/environments.ts', /createRoute/, /app\.openapi/)
  assertIncludes('server/routes/sessions.ts', /createRoute/, /app\.openapi/)
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

Then('the v1 console supports sending runtime tasks and inspecting session events', () => {
  runUnitTest('src/App.test.tsx')
})
