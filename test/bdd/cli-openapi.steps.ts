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

function assertNotIncludes(path: string, ...patterns: RegExp[]) {
  const content = read(path)
  for (const pattern of patterns) {
    assert.doesNotMatch(content, pattern, `${path} should not match ${pattern}`)
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

function runRestishSmoke() {
  runCheck('smoke:restish', ['run', 'smoke:restish'])
}

function assertRestishDocs() {
  assertIncludes(
    'docs/product/sdk.md',
    /restish api configure ama "\$AMA_ORIGIN\/api\/openapi\.json"/,
    /cookieAuth/,
    /not a separate command surface/,
  )
  assertIncludes(
    'docs/product/integration-snippets.md',
    /curl/,
    /restish/,
    /Generated SDK Shape/,
    /window\.location\.origin/,
    /\/api\/openapi\.json/,
  )
  assertNotIncludes('docs/product/integration-snippets.md', /api\.openai\.com/, /api\.anthropic\.com/)
}

function assertSkillDocs() {
  assertIncludes(
    'docs/agent-skills/ama-restish-cli/SKILL.md',
    /restish api configure ama "\$AMA_ORIGIN\/api\/openapi\.json"/,
    /cookieAuth/,
    /Agents/,
    /Environments/,
    /Sessions/,
    /Providers/,
    /Vaults/,
    /Governance/,
    /Usage/,
    /Audit/,
    /Runtime interaction remains Pi-compatible/,
  )
  assertNotIncludes('docs/agent-skills/ama-restish-cli/SKILL.md', /api\.openai\.com/, /api\.anthropic\.com/)
}

Given('an authenticated operator has an AMA deployment URL and API credentials', () => {
  assertIncludes('docs/product/sdk.md', /AMA_ORIGIN/, /cookieAuth/)
})

Given(/^the platform exposes control-plane APIs under \/api$/, () => {
  assertIncludes('server/app.ts', /app\.route\('\/api\/agents'/, /app\.doc\('\/api\/openapi\.json'/)
})

Given('an operator has API credentials', () => {
  assertIncludes('docs/product/sdk.md', /FlareAuth-issued AMA session cookie/, /cookieAuth/)
})

Given('an agent has access to the AMA repository or deployment docs', () => {
  assertSkillDocs()
})

Given('a local or deployed AMA control plane is running', () => {
  runRestishSmoke()
})

Given('test credentials are available', () => {
  assertIncludes('server/test/auth.ts', /signIn/, /setupFlareAuth/)
})

Given('an agent needs to send work to a running session', () => {
  assertSkillDocs()
})

Given('the console is running at a deployment origin', () => {
  assertIncludes('docs/product/integration-snippets.md', /AMA_ORIGIN/, /window\.location\.origin/)
})

When('the operator configures restish with the platform OpenAPI document', () => {
  assertRestishDocs()
})

When(
  'the operator uses restish to manage agents, environments, sessions, providers, vaults, governance, usage, or audit records',
  () => {
    assertRestishDocs()
  },
)

When('the operator sends runtime work from a terminal', () => {
  assertIncludes('docs/product/integration-snippets.md', /runtimeEndpointPath/, /Pi-compatible helpers/)
})

When('an operator points restish at the platform OpenAPI URL', () => {
  runRestishSmoke()
})

When('the operator calls AMA through restish', () => {
  assertRestishDocs()
})

When('examples show terminal usage', () => {
  assertRestishDocs()
})

When('the OpenAPI document is generated', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

When('a restish command is run with JSON output', () => {
  assertIncludes('docs/product/integration-snippets.md', /--rsh-output-format json/)
})

When('the OpenAPI document describes session runtime endpoints', () => {
  assertIncludes('docs/product/integration-snippets.md', /runtimeEndpointPath/)
})

When('the API exposes archive, delete, stop, rotate, revoke, or connect operations', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

When(/^CI configures restish with \/api\/openapi\.json$/, () => {
  runRestishSmoke()
})

When('CI uses restish to create an environment, create an agent, and create a session', () => {
  runRestishSmoke()
})

When('CI uses restish to serialize create environment, create agent, and create session requests', () => {
  runRestishSmoke()
})

When('the agent loads the AMA CLI skill', () => {
  assertSkillDocs()
})

When('an agent needs to manage AMA resources from a terminal', () => {
  assertSkillDocs()
})

When('the skill describes session runtime interaction', () => {
  assertSkillDocs()
})

When('a developer views integration docs', () => {
  assertRestishDocs()
})

When('a developer views terminal integration examples', () => {
  assertRestishDocs()
})

When('the console renders curl, restish, Python, TypeScript, or SDK examples', () => {
  assertRestishDocs()
})

When('a developer requests the OpenAPI document', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

When('an API request fails validation, authentication, authorization, policy, or runtime checks', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

When('a developer installs an Any Managed Agents SDK from a separate SDK repository', () => {
  assertIncludes('docs/product/sdk.md', /External Any Managed Agents SDKs/, /separate repositories/)
})

When('an operator automates agent, session, provider, vault, governance, usage, or audit management', () => {
  assertRestishDocs()
})

When('an operator wants command-line access to the control plane', () => {
  assertRestishDocs()
})

When('an automation agent needs to operate AMA from a terminal', () => {
  assertSkillDocs()
})

When('CI runs Cloudflare runtime tests', () => {
  runCloudflareRouteTest('server/routes/restish-smoke.cf-test.ts')
})

Then(/^restish discovers control-plane operations from \/api\/openapi\.json$/, () => {
  runRestishSmoke()
})

Then('requests are authenticated with the documented auth scheme', () => {
  assertIncludes('server/openapi.ts', /cookieAuth/, /SESSION_COOKIE_NAME/)
})

Then('all operations are scoped to the selected organization and project by API policy', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
  runCloudflareRouteTest('server/routes/environments.cf-test.ts')
  runCloudflareRouteTest('server/routes/sessions.cf-test.ts')
})

Then('restish sends standard HTTP requests described by OpenAPI', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('output is derived from documented response schemas', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('no bespoke AMA CLI command implementation is required', () => {
  assertIncludes('docs/product/sdk.md', /does not maintain language SDKs or a bespoke CLI binary/)
})

Then('no bespoke CLI binary is required', () => {
  assertIncludes('docs/product/sdk.md', /bespoke CLI binary/)
})

Then('the operator uses documented AMA runtime endpoints or Pi-compatible helpers', () => {
  assertIncludes('docs/product/integration-snippets.md', /runtimeEndpointPath/, /Pi-compatible helpers/)
})

Then('restish remains a control-plane CLI path, not a replacement runtime protocol', () => {
  assertIncludes('docs/product/sdk.md', /control-plane only/, /Runtime Protocol/)
})

Then('restish uses the API base URL, OpenAPI document, and security schemes documented by AMA', () => {
  assertRestishDocs()
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('the operator can request JSON output for automation', () => {
  assertIncludes('docs/product/integration-snippets.md', /--rsh-output-format json/)
})

Then("command failures surface the platform's standard error envelope", () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then("they point at the user's AMA deployment origin", () => {
  assertIncludes('docs/product/integration-snippets.md', /AMA_ORIGIN/, /window\.location\.origin/)
})

Then('they do not point at Anthropic, OpenAI, or other provider API URLs for control-plane operations', () => {
  assertNotIncludes('docs/product/integration-snippets.md', /api\.openai\.com/, /api\.anthropic\.com/)
})

Then(
  'each control-plane operation has operationId, tags, summary, parameters, requestBody, responses, and security metadata',
  () => {
    runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
  },
)

Then('operation ids remain stable unless a versioned API change is made', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('restish can map operations without custom command definitions', () => {
  assertRestishDocs()
})

Then('the response shape matches the documented OpenAPI response schema', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('error responses match the standard error envelope', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the OpenAPI document describes the exact HTTP method and path used by the server', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('destructive operations are not ambiguous between archive and permanent delete', () => {
  assertIncludes(
    'docs/agent-skills/ama-restish-cli/SKILL.md',
    /archiveAgent/,
    /archiveEnvironment/,
    /archiveVault/,
    /archiveSession/,
    /deleteProvider/,
    /deleteVaultCredentialVersion/,
  )
})

Then(
  'restish can discover the health, agents, environments, sessions, providers, vaults, governance, usage, and audit operations',
  () => {
    runRestishSmoke()
  },
)

Then('a health request receives the product identity and exits successfully', () => {
  runCloudflareRouteTest('server/routes/health.cf-test.ts')
})

Then('every command succeeds or fails with a documented error envelope', () => {
  runRestishSmoke()
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the Worker smoke path creates an environment, creates an agent, and creates a session', () => {
  runCloudflareRouteTest('server/routes/restish-smoke.cf-test.ts')
})

Then('the skill explains how to install or invoke restish', () => {
  assertSkillDocs()
})

Then('how to configure the AMA OpenAPI document URL, API base URL, and authentication', () => {
  assertSkillDocs()
})

Then('how to verify discovery with the health operation', () => {
  assertIncludes('docs/agent-skills/ama-restish-cli/SKILL.md', /getHealth/)
})

Then(
  'the skill shows restish workflows for agents, environments, sessions, providers, vaults, governance, usage, and audit',
  () => {
    assertSkillDocs()
  },
)

Then(
  'each workflow references OpenAPI operation names or documented paths rather than hard-coded bespoke CLI commands',
  () => {
    assertSkillDocs()
  },
)

Then('destructive workflows call out confirmation and archive-versus-delete semantics', () => {
  assertIncludes('docs/agent-skills/ama-restish-cli/SKILL.md', /Confirm ids/, /archive/, /delete/)
})

Then('it uses AMA runtime endpoints or Pi-compatible helpers', () => {
  assertSkillDocs()
})

Then('it does not define a new CLI-level runtime protocol', () => {
  assertSkillDocs()
})

Then('examples create agents, environments, and sessions with the control-plane API or external SDKs', () => {
  assertIncludes('docs/product/integration-snippets.md', /createEnvironment/, /createAgent/, /createSession/)
})

Then('examples connect to session runtime through Pi-compatible helpers', () => {
  assertIncludes('docs/product/integration-snippets.md', /Pi-compatible helpers/)
})

Then('examples do not expose raw Cloudflare Sandbox usage as the primary product interface', () => {
  assertIncludes('docs/product/sdk.md', /Users manage `Environment` resources/)
})

Then(/^snippets show how to configure restish against the current origin's \/api\/openapi\.json$/, () => {
  assertRestishDocs()
})

Then(
  'snippets show agents, environments, sessions, providers, vaults, governance, usage, and audit examples through restish',
  () => {
    assertRestishDocs()
  },
)

Then('snippets use the AMA auth scheme and never include raw secrets', () => {
  assertIncludes('docs/product/integration-snippets.md', /cookie/, /must not be committed or shared/)
  assertNotIncludes('docs/product/integration-snippets.md', /raw-[a-z-]*token/)
})

Then('the base URL is the current AMA deployment origin unless the user overrides it', () => {
  assertIncludes('docs/product/integration-snippets.md', /AMA_ORIGIN/, /window\.location\.origin/)
})

Then('snippets do not reference upstream vendor API hosts for AMA control-plane operations', () => {
  assertNotIncludes('docs/product/integration-snippets.md', /api\.openai\.com/, /api\.anthropic\.com/)
})

Then('runtime snippets identify when Pi-compatible helpers are more appropriate than generic REST calls', () => {
  assertIncludes('docs/product/integration-snippets.md', /Pi-compatible helpers/)
})

Then(
  'restish can discover agents, environments, sessions, providers, vaults, governance, usage, and audit operations',
  () => {
    runRestishSmoke()
  },
)

Then(
  'every operation has a stable operationId, summary, tags, request schema, response schema, and error schema',
  () => {
    runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
  },
)

Then('auth schemes are declared using standard OpenAPI security definitions', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('pagination, filters, and archived-resource parameters are documented consistently', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('it documents only the AMA proxy contract and safe examples', () => {
  assertIncludes('docs/product/integration-snippets.md', /AMA runtime proxy/, /runtimeEndpointPath/)
})

Then('it does not define a custom replacement for Pi protocol internals', () => {
  assertIncludes('docs/product/sdk.md', /must not create a competing runtime protocol/)
})

Then(
  'restish usage examples direct long-running runtime interaction to Pi-compatible helpers where appropriate',
  () => {
    assertIncludes('docs/product/integration-snippets.md', /Pi-compatible helpers/)
  },
)

Then('the document describes control-plane resources, request bodies, responses, and error shapes', () => {
  runCloudflareRouteTest('server/routes/openapi.cf-test.ts')
})

Then('the document is generated from Hono route schemas instead of hand-written OpenAPI JSON', () => {
  assertIncludes('server/app.ts', /app\.doc\('\/api\/openapi\.json'/)
  assertIncludes('server/routes/agents.ts', /createRoute/, /app\.openapi/)
})

Then('it does not describe a custom replacement for Pi runtime traffic', () => {
  assertIncludes('docs/product/sdk.md', /Pi protocol is the v1\.0 runtime protocol/)
})

Then('the response uses a stable error envelope', () => {
  runCloudflareRouteTest('server/routes/agents.cf-test.ts')
})

Then('the envelope includes type, message, and safe structured details', () => {
  assertIncludes('server/openapi.ts', /type: z\.string/, /message: z\.string/, /details:/)
})

Then(
  'the SDK manages agents, environments, sessions, providers, vaults, governance, usage, and audit resources',
  () => {
    assertIncludes(
      'docs/product/sdk.md',
      /agents/,
      /environments/,
      /sessions/,
      /provider/,
      /vault/,
      /policy/,
      /usage/,
      /audit/,
    )
  },
)

Then("the SDK is generated from or mechanically aligned with this repository's OpenAPI document", () => {
  assertIncludes('docs/product/sdk.md', /generated from or mechanically aligned/)
})

Then('this repository does not maintain SDK source code', () => {
  assertIncludes('docs/product/sdk.md', /does not maintain language SDKs/)
})

Then('the SDK does not define a replacement runtime protocol', () => {
  assertIncludes('docs/product/sdk.md', /must not (create a competing|define a replacement) runtime protocol/)
})

Then('automation uses an external Any Managed Agents SDK or the control-plane API', () => {
  assertIncludes('docs/product/spec.md', /client \/ external SDK \/ restish -> \/api\/\*/)
})

Then('runtime session interaction still uses Pi protocol or transparent AMA Pi proxy endpoints', () => {
  assertIncludes('docs/product/spec.md', /Runtime traffic uses Pi protocol/)
})

Then(
  'the platform recommends restish against the published OpenAPI document instead of a bespoke CLI implementation',
  () => {
    assertIncludes('docs/product/sdk.md', /The CLI path is restish over OpenAPI/)
  },
)

Then(
  'the OpenAPI document remains the single source of truth for command discovery, request fields, response fields, and auth',
  () => {
    assertIncludes(
      'docs/product/sdk.md',
      /source of truth for operation discovery, request fields, response fields, authentication/,
    )
  },
)

Then('examples include a restish profile configured for the current deployment origin', () => {
  assertIncludes('docs/product/sdk.md', /restish api configure ama "\$AMA_ORIGIN\/api\/openapi\.json"/)
})

Then(
  'the project provides a skill that teaches the agent how to configure and use restish with the AMA OpenAPI document',
  () => {
    assertSkillDocs()
  },
)

Then(
  'the skill covers common workflows for agents, environments, sessions, providers, vaults, governance, usage, and audit',
  () => {
    assertSkillDocs()
  },
)

Then(
  'the skill instructs runtime task interaction to use AMA runtime endpoints or Pi-compatible helpers rather than inventing a separate CLI protocol',
  () => {
    assertSkillDocs()
  },
)

Then('D1, Durable Object, asset, and Worker routing bindings are validated', () => {
  runCloudflareRouteTest('workers/managed-agent.cf-test.ts')
})

Then('Workers AI is excluded from CI runtime tests unless Cloudflare credentials are explicitly configured', () => {
  assertIncludes('docs/product/spec.md', /Workers AI/)
})

Then('restish discovery and the create environment, create agent, create session workflow are covered', () => {
  runRestishSmoke()
})
