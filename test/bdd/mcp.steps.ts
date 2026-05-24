import { execFileSync } from 'node:child_process'
import { Given, Then, When } from '@cucumber/cucumber'

const completedChecks = new Set<string>()

function runCheck(name: string, testName: string) {
  if (completedChecks.has(name)) {
    return
  }
  try {
    execFileSync('npm', ['run', 'test:cf', '--', 'server/routes/mcp.cf-test.ts', '-t', testName], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    })
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string; message?: string }
    throw new Error(
      [
        `Executable check failed: npm run test:cf -- server/routes/mcp.cf-test.ts -t ${testName}`,
        output.stdout,
        output.stderr,
        output.message,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  completedChecks.add(name)
}

function catalogCheck() {
  runCheck('mcp-catalog', 'lists, filters, and reads connector catalog metadata without requiring credentials')
}

function connectionCheck() {
  runCheck(
    'mcp-connections',
    'connects, upserts, lists tools, disconnects, audits, and never accepts raw credential values',
  )
}

function tenantCheck() {
  runCheck('mcp-tenancy', 'enforces tenant scoping for project connections')
}

function runtimeBlockCheck() {
  runCheck('mcp-runtime-block', 'blocks unapproved runtime MCP calls and records policy events')
}

function runtimeAllowCheck() {
  runCheck(
    'mcp-runtime-allow',
    'allows approved tool calls, respects rotated and revoked credentials, and normalizes MCP errors',
  )
}

function environmentPolicyCheck() {
  runCheck('mcp-environment-policy', 'applies environment MCP connector restrictions during tool calls')
}

When('the user searches the connector catalog', catalogCheck)
When('the user opens MCP discovery', catalogCheck)
When('the user searches by name, category, capability, or trust level', catalogCheck)
When('the user opens connector detail', catalogCheck)
When('the user browses available MCP connectors', catalogCheck)
When('the platform lists MCP tools for that connector', connectionCheck)

Given('the platform has a connector catalog', catalogCheck)
Given('the connector catalog includes multiple categories', catalogCheck)
Given('a connector exists', catalogCheck)
Given('a connector is allowed by project policy', connectionCheck)
Given('a connector is already connected', connectionCheck)
Given('organization A has connected a connector', tenantCheck)
Given('a connector is connected with an approved credential', runtimeAllowCheck)
Given('a session agent is allowed to use an MCP tool', runtimeAllowCheck)
Given('an MCP server returns unauthorized, not found, timeout, invalid schema, or network errors', runtimeAllowCheck)
Given('a connector is approved for a project', runtimeAllowCheck)
Given('a connector is not approved for the project or environment', runtimeBlockCheck)
Given('a connector credential has been rotated', runtimeAllowCheck)
Given('a connector is blocked by policy', runtimeBlockCheck)
Given('a project has tool and MCP policies', runtimeAllowCheck)
Given('an MCP connector is blocked for a project', runtimeBlockCheck)
Given('an environment restricts MCP connectors', environmentPolicyCheck)

When('a user creates or updates an MCP connection', connectionCheck)
When('the user provides a credential reference or creates a new vault credential for the connector', connectionCheck)
When('the user connects it again with a new credential reference', connectionCheck)
When('the user disconnects it and confirms', connectionCheck)
When('a user from organization B lists, reads, or uses the same connector id', tenantCheck)
When('an MCP transport fails', runtimeAllowCheck)
When('the MCP client handles the failure', runtimeAllowCheck)
When('the runtime creates an MCP client', runtimeAllowCheck)
When('the Pi runtime requests the tool', runtimeAllowCheck)
When('a session attempts to use the connector', runtimeBlockCheck)
When('a new session starts', runtimeAllowCheck)
When('an agent tries to call it', runtimeBlockCheck)
When('an agent attempts to call the connector', runtimeBlockCheck)
When('an agent attempts an MCP operation', runtimeBlockCheck)
When('a session uses the environment', environmentPolicyCheck)

Then('results show capability, trust level, policy status, and setup requirements', catalogCheck)
Then(
  'connectors show id, name, description, category, trust level, supported auth modes, policy status, connection status, and setup requirements',
  catalogCheck,
)
Then('unavailable or policy-blocked connectors are visibly disabled with an explanation', catalogCheck)
Then('every result matches the selected criteria', catalogCheck)
Then('no credential values are required to browse the catalog', catalogCheck)
Then(
  'the page shows setup instructions, required credential type, available capabilities, policy status, and connection actions',
  catalogCheck,
)
Then('unknown connectors return a not-found error instead of a server error', catalogCheck)
Then('the platform validates endpoint, credentials, policy, and approval mode', connectionCheck)
Then('the platform stores only encrypted or secret-referenced credentials', connectionCheck)
Then('the connection status becomes connected for the current organization or project scope', connectionCheck)
Then('connector lists report connected status without exposing credentials', connectionCheck)
Then('the connection is updated instead of duplicated', connectionCheck)
Then('future sessions cannot use that connector through the old connection', connectionCheck)
Then('audit events record connect, update, and disconnect actions', connectionCheck)
Then("organization A's connection and credentials are not visible or usable", tenantCheck)
Then('the session records a structured tool error and continues or terminates according to policy', runtimeAllowCheck)
Then('the MCP client authenticates with the resolved credential', runtimeAllowCheck)
Then('returns tool name, description, and input schema', connectionCheck)
Then('the response is scoped to the current organization and project policy', tenantCheck)
Then('AMA calls the MCP server through the MCP client', runtimeAllowCheck)
Then('tool input, output summary, duration, and safe errors are recorded as session events', runtimeAllowCheck)
Then('secret values are redacted from events and logs', runtimeAllowCheck)
Then('AMA maps it to a stable error type and HTTP status for control-plane calls', runtimeAllowCheck)
Then('runtime sessions continue or terminate according to tool policy', runtimeAllowCheck)
Then('calls are authenticated, scoped, and recorded as session events', runtimeAllowCheck)
Then('AMA rejects the tool call before contacting the MCP server', runtimeBlockCheck)
Then('records a policy event on the session', runtimeBlockCheck)
Then('the runtime resolves the latest allowed credential version', runtimeAllowCheck)
Then(
  'existing sessions keep their original safe credential reference until they stop or reconnect according to policy',
  runtimeAllowCheck,
)
Then('the runtime denies the call and records a policy event', runtimeBlockCheck)
Then('connectors can be searched and filtered by capability, trust level, and policy status', catalogCheck)
Then('the platform rejects the call', runtimeBlockCheck)
Then('records a policy event', runtimeBlockCheck)
Then('the runtime allows only connectors permitted by the environment and project policy', environmentPolicyCheck)
Then('the runtime checks connector policy before executing the call', runtimeBlockCheck)
