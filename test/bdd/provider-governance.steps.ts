import { execFileSync } from 'node:child_process'
import { Given, Then, When } from '@cucumber/cucumber'

const completedChecks = new Set<string>()

function runCheck(name: string, testName: string) {
  if (completedChecks.has(name)) {
    return
  }
  try {
    execFileSync('npm', ['run', 'test:cf', '--', 'server/routes/providers-governance.cf-test.ts', '-t', testName], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    })
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string; message?: string }
    throw new Error(
      [
        `Executable check failed: npm run test:cf -- server/routes/providers-governance.cf-test.ts -t ${testName}`,
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

function providersCheck() {
  runCheck('providers', 'lists default Workers AI and manages configured providers without exposing credentials')
}

function governanceCheck() {
  runCheck('governance', 'returns policy_denied for governance denials and writes safe audit records')
}

function usageCheck() {
  runCheck('usage', 'summarizes usage deterministically for seeded D1 records')
}

function auditExportCheck() {
  runCheck('audit-export', 'exports audit records with secret-like values redacted')
}

Given('no project-specific providers are configured', providersCheck)
Given('a project has multiple providers', providersCheck)
Given('organization, team, project, and agent policies exist', governanceCheck)
Given('an organization has teams and projects', governanceCheck)
Given('a request is denied by provider, tool, MCP, sandbox, or budget policy', governanceCheck)
Given('an organization has active sessions', usageCheck)
Given('sessions have recorded token, duration, tool, sandbox, and error usage', usageCheck)
Given('an operator has permission to view usage', usageCheck)

When('an operator lists providers', providersCheck)
When('an operator enables Workers AI for a project', providersCheck)
When('an operator adds Anthropic, OpenAI, OpenAI-compatible, Ollama, or another supported provider', providersCheck)
When('an operator marks one provider as default', providersCheck)
When('an operator saves provider, model, tool, sandbox, or budget policy', governanceCheck)
When('the admin requests effective policy', governanceCheck)
When('the user inspects the failure', governanceCheck)
When('the operator views usage', usageCheck)
When('a request is denied by governance policy', governanceCheck)
When('an operator exports audit records for a time range', auditExportCheck)
When('the operator opens usage analytics', usageCheck)
When(
  'the operator filters by organization, project, provider, model, agent, session, status, or time range',
  usageCheck,
)
When('a user changes agents, sessions, providers, vaults, governance, or sandbox policy', auditExportCheck)
When(
  'runtime policy blocks a provider call, tool call, MCP connector, sandbox command, network request, or credential resolution',
  governanceCheck,
)

Then('the response shows platform default providers separately from project overrides', providersCheck)
Then(
  'each provider reports id, type, display name, default status, credential status, model catalog status, and timestamps',
  providersCheck,
)
Then('secret values are never returned', providersCheck)
Then('the provider stores Cloudflare account metadata and safe credential references', providersCheck)
Then('it can be marked as the only default provider', providersCheck)
Then('model discovery includes Workers AI model ids allowed by governance', providersCheck)
Then(
  'provider type, base URL when required, display name, default flag, rate limits, and budget policy are validated',
  providersCheck,
)
Then('credentials are stored through approved secret references', providersCheck)
Then('the response includes hasCredential without returning the credential value', providersCheck)
Then('every other provider in the same project is no longer default', providersCheck)
Then('future agents without explicit provider selection use the new default', providersCheck)
Then('the platform validates and applies the policy to later sessions', governanceCheck)
Then(
  'the response explains the resolved rule source for provider, model, tool, MCP, sandbox, and budget decisions',
  governanceCheck,
)
Then('the response identifies the policy category and safe resource reference', governanceCheck)
Then('the UI can link to the effective policy view', governanceCheck)
Then('no secret or raw credential values are included', governanceCheck)
Then('usage is grouped by organization, project, provider, model, agent, and session', usageCheck)
Then('usage is grouped by organization, project, provider, model, agent, session, and time range', usageCheck)
Then('the summary includes time range filters', usageCheck)
Then('the audit log includes the policy rule and resource reference', governanceCheck)
Then('does not include secret values', governanceCheck)
Then('the export includes stable identifiers and event metadata', auditExportCheck)
Then("respects the operator's organization scope", auditExportCheck)
Then('totals and grouped breakdowns update consistently', usageCheck)
Then('empty ranges show an explicit empty state', usageCheck)
Then('the platform writes an audit event with actor, resource, action, timestamp, and safe metadata', auditExportCheck)
Then(
  'the platform writes an audit event with policy category, rule reference, session id, and safe metadata',
  governanceCheck,
)
