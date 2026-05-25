import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { Given, Then, When } from '@cucumber/cucumber'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

function readConsoleFeatureViews() {
  return [
    'src/features/agents/AgentsView.tsx',
    'src/features/agents/AgentDetailView.tsx',
    'src/features/environments/EnvironmentsView.tsx',
    'src/features/environments/EnvironmentDetailView.tsx',
    'src/features/sessions/SessionsView.tsx',
    'src/features/sessions/SessionDetailView.tsx',
    'src/features/providers/ProvidersView.tsx',
    'src/features/providers/ProviderDetailView.tsx',
    'src/features/vaults/VaultsView.tsx',
    'src/features/vaults/VaultDetailView.tsx',
    'src/features/mcp/McpView.tsx',
    'src/features/usage/UsageView.tsx',
    'src/features/audit/AuditView.tsx',
    'src/features/settings/GovernanceView.tsx',
    'src/features/quickstart/QuickstartView.tsx',
    'src/features/console/json-block.tsx',
    'src/features/console/related-resources-table.tsx',
  ]
    .map(read)
    .join('\n')
}

Given('the platform is designed as a self-hostable Cloudflare Workers application', () => {
  const wrangler = read('wrangler.toml')
  assert.match(wrangler, /main = "\.\/workers\/bootstrap\.ts"/)
})

Then('the application must run on Cloudflare Workers', () => {
  const worker = read('workers/bootstrap.ts')
  const wrangler = read('wrangler.toml')
  assert.match(worker, /satisfies ExportedHandler/)
  assert.match(wrangler, /compatibility_date = /)
})

Then('the application must use Cloudflare-compatible platform services for control-plane state', () => {
  const wrangler = read('wrangler.toml')
  assert.match(wrangler, /\[\[d1_databases\]\]/)
  assert.match(wrangler, /\[\[durable_objects\.bindings\]\]/)
})

Then('agent runtime traffic must use Pi protocol through Cloudflare Sandbox', () => {
  const spec = read('docs/product/spec.md')
  const decisions = read('docs/product/decisions.md')
  assert.match(spec, /v1\.0 agent runtime is Pi coding agent running inside a per-session Cloudflare Sandbox/)
  assert.match(spec, /Runtime traffic uses Pi protocol directly or through a transparent AMA proxy/)
  assert.match(decisions, /v1\.0 runs Pi coding agent inside one Cloudflare Sandbox per session/)
})

Then('the platform must not define a competing custom agent runtime protocol', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /does not maintain a competing runtime SDK or incompatible runtime protocol/)
  assert.match(spec, /AMA must proxy or adapt Pi protocol rather than inventing a new incompatible runtime protocol/)
  assert.match(spec, /Cloudflare Agents SDK is not the v1\.0 runtime contract/)
})

Then('product APIs may exist only for control-plane resource management', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /The platform owns the control plane/)
  assert.match(spec, /Product SDKs manage control-plane resources/)
})

Then('this repository must publish the Any Managed Agents OpenAPI contract', () => {
  const app = read('server/app.ts')
  const sdk = read('docs/product/sdk.md')
  assert.match(app, /\/api\/openapi\.json/)
  assert.match(sdk, /publishes the Any Managed Agents control-plane OpenAPI contract/)
})

Then('this repository must not maintain language SDK source code', () => {
  const contributing = read('CONTRIBUTING.md')
  assert.match(contributing, /does not maintain SDK source code/)
  assert.match(contributing, /separate SDK repositories/)
})

Then('external SDK runtime helpers must delegate to Pi runtime endpoints', () => {
  const sdk = read('docs/product/sdk.md')
  assert.match(sdk, /connect to a running session/)
  assert.match(sdk, /Pi protocol or a transparent AMA Pi proxy endpoint/)
})

Then('sandbox execution must use Cloudflare Sandbox', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /Cloudflare Sandbox owns the filesystem, shell, process isolation/)
})

Then('the platform must not define a competing custom sandbox SDK', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /AMA must not define a custom sandbox SDK/)
  assert.match(spec, /Cloudflare Sandbox owns the filesystem, shell, process isolation/)
})

Then('Workers AI must be supported as a first-class model provider', () => {
  const wrangler = read('wrangler.toml')
  assert.match(wrangler, /\[ai\]/)
  assert.match(wrangler, /binding = "AI"/)
})

Then('Anthropic must not be required for the platform to operate', () => {
  const envExample = read('.env.example')
  assert.doesNotMatch(envExample, /ANTHROPIC_API_KEY/)
})

Then('the model layer must support all configured providers', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /model layer supports all configured providers/)
})

Then('BDD specs must describe product and platform behavior', () => {
  const principles = read('specs/product/platform-principles.feature')
  assert.match(principles, /Feature: Platform principles/)
})

Then('implementation work must be validated against the BDD specs', () => {
  const packageJson = read('package.json')
  assert.match(packageJson, /"bdd":/)
})

Then('BDD specs are not the primary end-user interface', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /not for end users/)
})

Then('the v1 release docs describe FlareAuth OIDC setup', () => {
  const readme = read('README.md')
  const deploy = read('docs/infra/cloudflare-deploy.md')
  const envExample = read('.env.example')
  assert.match(readme, /FlareAuth OIDC/)
  assert.match(deploy, /FLAREAUTH_ISSUER/)
  assert.match(deploy, /FLAREAUTH_CLIENT_ID/)
  assert.match(deploy, /FLAREAUTH_REDIRECT_URI/)
  assert.match(deploy, /PKCE/)
  assert.match(envExample, /FLAREAUTH_ISSUER=/)
})

Then('the v1 release docs describe Cloudflare Sandbox and Pi runtime setup', () => {
  const deploy = read('docs/infra/cloudflare-deploy.md')
  const dockerfile = read('Dockerfile')
  assert.match(deploy, /Cloudflare Sandbox/)
  assert.match(deploy, /Dockerfile/)
  assert.match(deploy, /pi-bridge\.mjs/)
  assert.match(dockerfile, /npm install -g @earendil-works\/pi-coding-agent/)
})

Then('the v1 release docs describe Workers AI model configuration', () => {
  const deploy = read('docs/infra/cloudflare-deploy.md')
  const envExample = read('.env.example')
  assert.match(deploy, /AMA_WORKERS_AI_ACCOUNT_ID/)
  assert.match(deploy, /AMA_RUNTIME_AI_PROXY_TOKEN/)
  assert.match(deploy, /AI binding/)
  assert.match(deploy, /cloudflare-workers-ai/)
  assert.match(envExample, /AMA_DEFAULT_MODEL=@cf\/moonshotai\/kimi-k2\.6/)
})

Then('the v1 release docs forbid request-time package installation for the runtime image', () => {
  const deploy = read('docs/infra/cloudflare-deploy.md')
  assert.match(deploy, /must not install npm packages during session start/)
  assert.match(deploy, /baked into the container image/)
})

Then('the v1 web console can create environments, agents, and sessions', () => {
  const app = read('src/App.tsx')
  const router = read('src/app/router.tsx')
  const layout = read('src/features/console/ConsoleLayout.tsx')
  const controller = read('src/features/console/use-console-controller.ts')
  const createSheet = read('src/features/console/CreateResourceSheet.tsx')
  const api = read('src/lib/api.ts')
  const forms = read('src/console/forms.tsx')
  const views = readConsoleFeatureViews()
  const components = read('src/console/components.tsx')
  assert.match(app, /QueryClientProvider/)
  assert.match(app, /RouterProvider/)
  assert.match(router, /createBrowserRouter/)
  assert.match(router, /AgentsPage/)
  assert.match(router, /EnvironmentsPage/)
  assert.match(router, /SessionsPage/)
  assert.match(controller, /useQuery/)
  assert.match(controller, /useMutation/)
  assert.match(controller, /viewFromPath/)
  assert.match(layout, /@\/components\/ui\/button/)
  assert.match(createSheet, /@\/components\/ui\/sheet/)
  assert.match(forms, /@\/components\/ui\/input/)
  assert.match(forms, /@\/components\/ui\/select/)
  assert.match(views, /@\/components\/ui\/card/)
  assert.match(views, /@\/components\/ui\/scroll-area/)
  assert.match(components, /@\/components\/ui\/badge/)
  assert.match(controller, /createMode/)
  assert.doesNotMatch(layout, /Acceptance Path/)
  assert.match(controller, /openCreateSession/)
  assert.match(api, /createEnvironment/)
  assert.match(api, /createAgent/)
  assert.match(api, /createSession/)
})

Then('the v1 web console can send runtime messages and inspect session events', () => {
  const runtimeHook = read('src/features/sessions/use-pi-runtime-session.ts')
  const runtimePanel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(runtimePanel, /Send/)
  assert.match(runtimePanel, /Transcript/)
  assert.match(runtimeHook, /new WebSocket/)
  assert.match(runtimeHook, /sendPrompt/)
  assert.match(runtimePanel, /MessageResponse/)
  assert.match(runtimePanel, /Tool/)
  assert.doesNotMatch(runtimeHook, /EventSource/)
  assert.doesNotMatch(runtimeHook, /readRuntimeEvents/)
})

Then('v1 release checks include lint, typecheck, unit tests, BDD, Cloudflare tests, and build', () => {
  const packageJson = read('package.json')
  assert.match(packageJson, /"lint":/)
  assert.match(packageJson, /"typecheck":/)
  assert.match(packageJson, /"test":/)
  assert.match(packageJson, /"bdd":/)
  assert.match(packageJson, /"test:cf":/)
  assert.match(packageJson, /"build":/)
})

Then('no external SDK source code is maintained in this repository', () => {
  const contributing = read('CONTRIBUTING.md')
  const sdk = read('docs/product/sdk.md')
  assert.match(contributing, /does not maintain SDK source code/)
  assert.match(sdk, /Product SDKs are generated and maintained in separate repositories/)
})

Then('v1 secret handling stores references and metadata instead of raw secret values', () => {
  const schema = read('server/db/schema.ts')
  const environments = read('server/routes/environments.ts')
  const app = read('src/App.tsx')
  assert.match(schema, /secretRefs/)
  assert.match(environments, /SecretRefSchema/)
  assert.doesNotMatch(app, /secret value/i)
})

Then(
  'the product UI\\/UX standards document defines the console style, layout, forms, states, accessibility, and responsive rules',
  () => {
    const standards = read('docs/product/ui-ux-standards.md')
    assert.match(standards, /Any Managed Agents is an operational control plane/)
    assert.match(standards, /## Product Style/)
    assert.match(standards, /## Architecture/)
    assert.match(standards, /## Shell And Navigation/)
    assert.match(standards, /## Layout/)
    assert.match(standards, /## Components/)
    assert.match(standards, /## Forms/)
    assert.match(standards, /## Feedback And State/)
    assert.match(standards, /## Accessibility/)
    assert.match(standards, /## Responsive Rules/)
    assert.match(standards, /## Implementation Checklist/)
  },
)

Then(
  'the web console architecture separates app providers, routing, feature pages, shared console shell, and reusable product components',
  () => {
    const app = read('src/App.tsx')
    const router = read('src/app/router.tsx')
    const layout = read('src/features/console/ConsoleLayout.tsx')
    const agentsPage = read('src/features/agents/AgentsPage.tsx')
    const environmentsPage = read('src/features/environments/EnvironmentsPage.tsx')
    const sessionsPage = read('src/features/sessions/SessionsPage.tsx')
    const productComponents = read('src/console/components.tsx')
    const productViews = readConsoleFeatureViews()
    assert.match(app, /QueryClientProvider/)
    assert.match(app, /RouterProvider/)
    assert.doesNotMatch(app, /AgentsView|EnvironmentForm|SessionsView|useQuery|useMutation/)
    assert.match(router, /createBrowserRouter/)
    assert.match(router, /AgentsPage/)
    assert.match(router, /EnvironmentsPage/)
    assert.match(router, /SessionsPage/)
    assert.match(layout, /ConsoleContextProvider/)
    assert.match(layout, /ConsoleShell/)
    assert.match(layout, /CreateResourceSheet/)
    assert.doesNotMatch(layout, /useQuery|useMutation|AgentForm|EnvironmentForm|SessionForm/)
    assert.doesNotMatch(layout, /<header/)
    assert.match(agentsPage, /useConsoleContext/)
    assert.match(environmentsPage, /useConsoleContext/)
    assert.match(sessionsPage, /useConsoleContext/)
    assert.match(productComponents, /StatusBadge/)
    assert.match(productViews, /AgentsView/)
    assert.equal(existsSync('src/console/views.tsx'), false)
  },
)

Then('the shared shell keeps user controls out of the content topbar', () => {
  const shell = read('src/features/console/ConsoleShell.tsx')
  const standards = read('docs/product/ui-ux-standards.md')
  assert.doesNotMatch(shell, /<header/)
  assert.doesNotMatch(shell, /SearchField|ArchivedToggle|RefreshCw|aria-label="Refresh"/)
  assert.match(shell, /<UserMenu placement="sidebar" \/>/)
  assert.match(shell, /<UserMenu placement="mobile" \/>/)
  assert.match(shell, /isSidebar \? 'mt-4 border-t pt-3'/)
  assert.match(shell, /fixed bottom-4 left-4 z-20 lg:hidden/)
  assert.doesNotMatch(shell, /bottom-4 right-4|lg:right-/)
  assert.match(shell, /DropdownMenu/)
  assert.match(shell, /const contentSide = isSidebar \? 'right' : 'top'/)
  assert.match(shell, /side=\{contentSide\}/)
  assert.match(shell, /ArrowRight/)
  assert.doesNotMatch(shell, /Log out\s*\n\s*<ArrowRight/)
  assert.match(standards, /right content area must not add a duplicate sticky topbar/)
  assert.match(standards, /desktop places it in the sidebar footer/)
  assert.match(standards, /menu opens from the right side of the sidebar/)
  assert.match(standards, /Logout is a direct menu action and must not use a submenu arrow/)
})

Then('feature operations stay out of the shared console context', () => {
  const context = read('src/features/console/console-context.tsx')
  const controller = read('src/features/console/use-console-controller.ts')
  const agentActions = read('src/features/agents/use-agent-actions.ts')
  const environmentActions = read('src/features/environments/use-environment-actions.ts')
  const sessionActions = read('src/features/sessions/use-session-actions.ts')
  const providerActions = read('src/features/providers/use-provider-actions.ts')
  const vaultActions = read('src/features/vaults/use-vault-actions.ts')
  const mcpActions = read('src/features/mcp/use-mcp-actions.ts')
  const standards = read('docs/product/ui-ux-standards.md')
  const sharedOperationNames =
    /archiveAgent|archiveEnvironment|archiveProvider|archiveVault|disconnectMcpConnection|stopSession|archiveSession/

  assert.doesNotMatch(context, sharedOperationNames)
  assert.doesNotMatch(controller, /api\.(archive|stop|disconnect)/)
  assert.match(agentActions, /api\.archiveAgent/)
  assert.match(environmentActions, /api\.archiveEnvironment/)
  assert.match(sessionActions, /api\.stopSession/)
  assert.match(sessionActions, /api\.archiveSession/)
  assert.match(providerActions, /api\.archiveProvider/)
  assert.match(vaultActions, /api\.archiveVault/)
  assert.match(mcpActions, /api\.disconnectMcpConnection/)
  assert.match(standards, /Shared context is not a page-operation service locator/)
})

Then('the web console uses React Query for server state instead of feature-level ad hoc loading loops', () => {
  const controller = read('src/features/console/use-console-controller.ts')
  const agentsPage = read('src/features/agents/AgentsPage.tsx')
  const environmentsPage = read('src/features/environments/EnvironmentsPage.tsx')
  const sessionsPage = read('src/features/sessions/SessionsPage.tsx')
  assert.match(controller, /useQuery/)
  assert.match(controller, /useMutation/)
  assert.match(controller, /invalidateQueries/)
  assert.doesNotMatch(agentsPage, /useEffect|fetch\(/)
  assert.doesNotMatch(environmentsPage, /useEffect|fetch\(/)
  assert.doesNotMatch(sessionsPage, /useEffect|fetch\(/)
})

Then('console pages compose shadcn primitives instead of legacy custom global component classes', () => {
  const styles = read('src/styles.css')
  const forms = read('src/console/forms.tsx')
  const views = readConsoleFeatureViews()
  const components = read('src/console/components.tsx')
  assert.doesNotMatch(styles, /\.panel|\.button-primary|\.icon-button|\.field-label|\.input|\.textarea/)
  assert.match(forms, /@\/components\/ui\/input/)
  assert.match(forms, /@\/components\/ui\/textarea/)
  assert.match(forms, /@\/components\/ui\/select/)
  assert.match(views, /@\/components\/ui\/card/)
  assert.match(views, /@\/components\/ui\/scroll-area/)
  assert.match(components, /@\/components\/ui\/button/)
  assert.match(components, /@\/components\/ui\/badge/)
})

Then('console forms use shadcn Field primitives for labels and helper text', () => {
  const forms = read('src/console/forms.tsx')
  const field = read('src/components/ui/field.tsx')
  const standards = read('docs/product/ui-ux-standards.md')
  assert.match(field, /FieldGroup/)
  assert.match(forms, /@\/components\/ui\/field/)
  assert.match(forms, /FieldGroup/)
  assert.match(forms, /FieldLabel/)
  assert.match(forms, /FieldDescription/)
  assert.match(
    standards,
    /Forms must use shadcn `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, and `FieldError`/,
  )
  assert.doesNotMatch(forms, /from '\.\/components'/)
  assert.doesNotMatch(forms, /className="space-y-|className="grid gap-1\.5"|<label className=/)
})

Then('browser clients use WebSocket for bidirectional Pi RPC commands and events', () => {
  const hook = read('src/features/sessions/use-pi-runtime-session.ts')
  const server = read('server/app.ts')
  assert.match(hook, /new WebSocket/)
  assert.match(hook, /sendPrompt/)
  assert.match(server, /\/ws/)
  assert.match(server, /WebSocketPair/)
  assert.match(server, /handleRuntimeWebSocketMessage/)
})

Then('AMA does not inject custom response or lifecycle events into the Pi runtime stream', () => {
  const server = read('server/app.ts')
  assert.doesNotMatch(server, /sendRuntimeJson\(socket, \{\s*type: 'response'/)
  assert.doesNotMatch(server, /websocket_message_completed|message_started|message_completed/)
})

Then('clients do not poll the runtime endpoint for NDJSON transcripts', () => {
  const api = read('src/lib/api.ts')
  const hook = read('src/features/sessions/use-pi-runtime-session.ts')
  assert.doesNotMatch(api, /readRuntimeEvents|sendRuntimeMessage/)
  assert.doesNotMatch(hook, /EventSource|setInterval|application\/x-ndjson/)
})

When('the user sends a message and the agent responds', () => {
  const server = read('server/app.ts')
  assert.match(server, /recordRuntimeMessageSubmission/)
  assert.match(server, /recordTestRuntimeMessageOutcome/)
})

Then('the platform records Pi runtime events in order', () => {
  const server = read('server/app.ts')
  assert.match(server, /appendPiRuntimeEvent/)
  assert.match(server, /max\(sessionEvents.sequence\)/)
  assert.match(server, /sequence: \(latest\?\.sequence \?\? 0\) \+ 1/)
})

Then('each stored runtime event preserves the Pi event type and payload', () => {
  const schema = read('server/db/schema.ts')
  const app = read('server/app.ts')
  assert.match(schema, /organizationId/)
  assert.match(schema, /projectId/)
  assert.match(schema, /sessionId/)
  assert.match(schema, /sequence/)
  assert.match(schema, /createdAt/)
  assert.match(app, /type: piEventType\(values\.event\)/)
  assert.match(app, /payload: JSON\.stringify\(redactRuntimeValue\(values\.event\)\)/)
})

Then('AMA control-plane lifecycle events are not mixed into the Pi runtime event log', () => {
  const app = read('server/app.ts')
  const routes = read('server/routes/sessions.ts')
  assert.doesNotMatch(app, /reason: 'message_started'|reason: 'message_completed'|websocket_message_completed/)
  assert.doesNotMatch(routes, /session_created/)
  assert.match(routes, /recordAudit/)
})

When('the client subscribes to session events', () => {
  const hook = read('src/features/sessions/use-pi-runtime-session.ts')
  assert.match(hook, /new WebSocket/)
})

Then('message deltas, tool calls, sandbox process updates, and final results are streamed over WebSocket', () => {
  const reducer = read('src/features/sessions/pi-runtime.ts')
  assert.match(reducer, /message_update/)
  assert.match(reducer, /tool_execution_start/)
  assert.match(reducer, /bridge_exit/)
  assert.match(reducer, /agent_end/)
})

Then('the stream carries Pi AgentSessionEvent payloads', () => {
  const reducer = read('src/features/sessions/pi-runtime.ts')
  assert.match(reducer, /agent_start/)
  assert.match(reducer, /turn_start/)
  assert.match(reducer, /message_end/)
  assert.match(reducer, /tool_execution_end/)
})

Then('reconnection can continue from the last acknowledged sequence', () => {
  const routes = read('server/routes/sessions.ts')
  assert.match(routes, /events\/stream/)
  assert.match(routes, /cursor/)
})

When('the user opens a session detail page', () => {
  const page = read('src/features/sessions/SessionDetailPage.tsx')
  assert.match(page, /SessionDetailView/)
})

Then('transcript is derived from Pi runtime events', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  const reducer = read('src/features/sessions/pi-runtime.ts')
  assert.match(panel, /Conversation/)
  assert.match(panel, /MessageResponse/)
  assert.match(reducer, /messageFromPiEvent/)
  assert.match(reducer, /mergePersistedEvents/)
})

Then('debug shows the full Pi runtime event stream with structured metadata', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /details/)
  assert.match(panel, /stringifyJson/)
})

When('a tool, provider, or sandbox emits sensitive values', () => {
  const app = read('server/app.ts')
  assert.match(app, /redactRuntimeValue/)
})

Then('event storage and event streams redact the secret values', () => {
  const app = read('server/app.ts')
  assert.match(app, /SENSITIVE_KEY/)
  assert.match(app, /REDACTED/)
})

Then('audit records keep only safe references', () => {
  const app = read('server/app.ts')
  assert.match(app, /recordAudit/)
  assert.match(app, /redactRuntimeValue/)
})

When('the user opens session detail', () => {
  const views = readConsoleFeatureViews()
  assert.match(views, /SessionDetailView/)
})

Then('transcript, debug events, status, agent snapshot, model, and sandbox references are visible', () => {
  const views = readConsoleFeatureViews()
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /Transcript/)
  assert.match(panel, /Debug/)
  assert.match(views, /StatusBadge/)
  assert.match(views, /agentSnapshot/)
  assert.match(views, /modelProvider/)
  assert.match(views, /sandboxId/)
})

Given('a session exists with immutable agent and environment snapshots', () => {
  const routes = read('server/routes/sessions.ts')
  assert.match(routes, /agentSnapshot/)
  assert.match(routes, /environmentSnapshot/)
})

Then(
  'the header shows title or id, status, agent, model provider, model, environment, duration, and runtime endpoint',
  () => {
    const views = readConsoleFeatureViews()
    assert.match(views, /session.title/)
    assert.match(views, /StatusBadge/)
    assert.match(views, /agentName/)
    assert.match(views, /modelProvider/)
    assert.match(views, /modelConfig/)
    assert.match(views, /environmentName/)
    assert.match(views, /formatDuration/)
    assert.match(views, /runtimeEndpointPath/)
  },
)

Then(
  'the snapshot panel shows agent instructions, tools, sandbox policy, environment packages, network policy, and safe secret references',
  () => {
    const views = readConsoleFeatureViews()
    assert.match(views, /instructions|systemPrompt/)
    assert.match(views, /allowedTools/)
    assert.match(views, /sandboxPolicy/)
    assert.match(views, /packages/)
    assert.match(views, /networkPolicy/)
    assert.match(views, /secretRefs/)
  },
)

Then('sandbox identifiers and Pi runtime identifiers are visible for debugging', () => {
  const views = readConsoleFeatureViews()
  assert.match(views, /sandboxId/)
  assert.match(views, /piRuntimeId/)
  assert.match(views, /piProcessId/)
})

Given('a session is idle and has an active runtime endpoint', () => {
  const bridge = read('server/runtime/pi/bridge.ts')
  assert.match(bridge, /runtimeEndpointPath/)
})

When('the user sends a message from the session detail composer', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /onSend/)
})

Then('the UI opens a WebSocket session to the AMA Pi runtime endpoint', () => {
  const hook = read('src/features/sessions/use-pi-runtime-session.ts')
  assert.match(hook, /runtimeWebSocketUrl/)
  assert.match(hook, /new WebSocket/)
})

Then('the UI sends the message as a Pi RPC prompt command', () => {
  const page = read('src/features/sessions/SessionDetailPage.tsx')
  assert.match(page, /sendPrompt/)
})

Then('the input shows a pending state while the message is accepted', () => {
  const prompt = read('src/components/ai-elements/prompt-input.tsx')
  assert.match(prompt, /busy/)
  assert.match(prompt, /Abort running agent/)
})

Then(
  'the transcript and debug views receive the same Pi runtime event stream without HTTP polling or a full page reload',
  () => {
    const hook = read('src/features/sessions/use-pi-runtime-session.ts')
    const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
    assert.match(hook, /addEventListener\('message'/)
    assert.match(panel, /runtime.messages/)
    assert.match(panel, /runtime.debugEvents/)
    assert.doesNotMatch(hook, /fetch\(|setInterval/)
  },
)

Then('failures show a recoverable error message with the session left inspectable', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  const reducer = read('src/features/sessions/pi-runtime.ts')
  const message = read('src/components/ai-elements/message.tsx')
  assert.match(reducer, /messageFromRuntimeError/)
  assert.match(panel, /statusDetail/)
  assert.match(message, /variant="destructive"/)
  assert.doesNotMatch(panel, /Banner/)
})

Given('a session receives Pi agent message, tool execution, lifecycle, and usage events', () => {
  const reducer = read('src/features/sessions/pi-runtime.ts')
  assert.match(reducer, /message_update/)
  assert.match(reducer, /tool_execution_end/)
  assert.match(reducer, /agent_start/)
  assert.match(reducer, /usage/)
})

When('the user opens transcript mode', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /value="transcript"/)
})

Then('user and assistant messages render as chat turns', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /Message /)
  assert.match(panel, /item\.message\.role/)
})

Then('transcript rows keep timestamps in compact message metadata instead of separate content rows', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  const message = read('src/components/ai-elements/message.tsx')
  assert.match(panel, /timestamp=\{formatTime\(item\.message\.createdAt\)\}/)
  assert.match(message, /timestamp \?/)
  assert.match(message, /status === 'error'/)
})

Then('tool executions render as structured tool rows', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /<Tool/)
})

Then('runtime progress renders as status rows', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /runtime.connection/)
  assert.match(panel, /runtime.runState/)
})

Then('raw JSON payloads are available only in debug detail panels', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /details/)
  assert.match(panel, /stringifyJson\(event.payload\)/)
})

Given('a session has Pi runtime events', () => {
  const app = read('server/app.ts')
  assert.match(app, /appendPiRuntimeEvent/)
  assert.match(app, /piEventType/)
  assert.doesNotMatch(app, /visibility: 'audit'/)
})

When('the user opens the session detail page', () => {
  const page = read('src/features/sessions/SessionDetailPage.tsx')
  assert.match(page, /SessionDetailView/)
})

When('the user selects transcript mode', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /TabsTrigger value="transcript"/)
})

Then('conversation-level messages and final results are emphasized', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /MessageResponse/)
})

Then('non-transcript Pi events are hidden but still available in debug mode', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /TabsContent value="debug"/)
})

When('the user selects debug mode', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /TabsTrigger value="debug"/)
})

Then('every Pi runtime event is visible with type, sequence, timestamp, payload summary, and raw detail panel', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /event.type/)
  assert.match(panel, /event.id/)
  assert.match(panel, /formatTime/)
  assert.match(panel, /stringifyJson/)
})

Given('a session has events', () => {
  const api = read('src/lib/api.ts')
  assert.match(api, /listSessionEvents/)
})

When('the user copies or downloads events', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /copyEvents/)
  assert.match(panel, /downloadEvents/)
})

Then('exported content preserves event order and safe metadata', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /sort\(\(a, b\) => a.sequence - b.sequence\)/)
})

Then('secret values remain redacted', () => {
  const app = read('server/app.ts')
  assert.match(app, /redactRuntimeValue/)
})

Given('a session has messages, tool calls, and sandbox events', () => {
  const reducer = read('src/features/sessions/pi-runtime.ts')
  assert.match(reducer, /message_update/)
  assert.match(reducer, /tool_execution_update/)
  assert.match(reducer, /bridge_exit/)
})

Then('the transcript view shows Pi runtime messages as chat turns', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /ConversationContent/)
  assert.match(panel, /MessageResponse/)
})

Then('tool calls render with structured status, input summary, output summary, and duration', () => {
  const tool = read('src/components/ai-elements/tool.tsx')
  assert.match(tool, /status/)
  assert.match(tool, /Input/)
  assert.match(tool, /Output/)
  assert.match(tool, /durationMs/)
})

Then('the debug view shows runtime events with structured details', () => {
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(panel, /filteredDebugEvents/)
  assert.match(panel, /details/)
})

Then('the composer sends normal chat messages instead of a task form', () => {
  const prompt = read('src/components/ai-elements/prompt-input.tsx')
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(prompt, /Send a message to the agent/)
  assert.doesNotMatch(panel, /task/i)
})

Then('console date and time rendering uses the shared dayjs formatter', () => {
  const packageJson = read('package.json')
  const format = read('src/console/format.ts')
  const views = readConsoleFeatureViews()
  assert.match(packageJson, /"dayjs":/)
  assert.match(format, /from 'dayjs'/)
  assert.match(format, /dayjs\(value\)\.format/)
  assert.doesNotMatch(views, /Intl\.DateTimeFormat|new Date\(/)
})

Then('destructive console actions require the shared confirmation dialog', () => {
  const alertDialog = read('src/components/ui/alert-dialog.tsx')
  const components = read('src/console/components.tsx')
  const views = readConsoleFeatureViews()
  assert.match(alertDialog, /AlertDialogPrimitive/)
  assert.match(components, /ConfirmAction/)
  assert.match(components, /@\/components\/ui\/alert-dialog/)
  assert.match(views, /ConfirmAction/)
  assert.match(views, /confirmLabel="Archive agent"/)
  assert.match(views, /confirmLabel="Archive environment"/)
  assert.match(views, /confirmLabel="Stop session"/)
  assert.match(views, /confirmLabel="Archive session"/)
  assert.doesNotMatch(views, /onClick=\{\(\) => onArchive\(agent\.id\)\}/)
  assert.doesNotMatch(views, /onClick=\{\(\) => onArchive\(environment\.id\)\}/)
  assert.doesNotMatch(views, /onClick=\{\(\) => onStop\(selectedSession\.id\)\}/)
  assert.doesNotMatch(views, /onClick=\{\(\) => onArchive\(selectedSession\.id\)\}/)
})

Then('operation feedback uses toast notifications instead of page-flow text', () => {
  const app = read('src/App.tsx')
  const toaster = read('src/components/ui/sonner.tsx')
  const controller = read('src/features/console/use-console-controller.ts')
  const layout = read('src/features/console/ConsoleLayout.tsx')
  const shell = read('src/features/console/ConsoleShell.tsx')
  const runtimePanel = read('src/features/sessions/SessionRuntimePanel.tsx')
  const standards = read('docs/product/ui-ux-standards.md')
  assert.match(app, /<Toaster \/>/)
  assert.match(toaster, /sonner/)
  assert.match(controller, /toast\.success/)
  assert.match(controller, /toast\.error/)
  assert.match(runtimePanel, /toast\.success/)
  assert.doesNotMatch(layout, /Banner|Session created|Agent created|Environment created|toast\./)
  assert.doesNotMatch(shell, /Banner|Session created|Agent created|Environment created/)
  assert.match(standards, /must use the shared toast component/)
  assert.match(standards, /must not render success or failure text inside the page content flow/)
})

Then('the UI\\/UX standards are indexed with the product specs', () => {
  const index = read('specs/product/spec-index.md')
  assert.match(index, /ui-ux-standards\.feature/)
  assert.match(index, /shared console UI\/UX standards/)
})

When('the user opens a resource list page', () => {
  assert.ok(existsSync('src/features/agents/AgentsPage.tsx'))
})

Then('the session detail route removes the contained console shell padding', () => {
  const shell = read('src/features/console/ConsoleShell.tsx')
  assert.match(shell, /fullBleed = \/\^\\\/sessions\\\/\[\^\/\]\+\//)
  assert.match(shell, /data-console-content=\{fullBleed \? 'full-bleed' : 'contained'\}/)
  assert.match(shell, /fullBleed \? 'p-0'/)
  assert.match(shell, /data-console-surface=\{fullBleed \? 'full-bleed' : 'contained'\}/)
})

Then('the session composer is compact and bottom aligned', () => {
  const prompt = read('src/components/ai-elements/prompt-input.tsx')
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(prompt, /data-density="compact"/)
  assert.match(prompt, /sticky bottom-0/)
  assert.match(prompt, /max-h-32 min-h-9/)
  assert.match(panel, /flex min-h-0 flex-1 flex-col/)
})

Then('transcript error details use the shared tooltip surface', () => {
  const message = read('src/components/ai-elements/message.tsx')
  const tool = read('src/components/ai-elements/tool.tsx')
  const panel = read('src/features/sessions/SessionRuntimePanel.tsx')
  assert.match(message, /@\/components\/ui\/tooltip/)
  assert.match(tool, /@\/components\/ui\/tooltip/)
  assert.match(panel, /StatusBadge/)
})

Then('resource tables use a viewport ref with an adaptive pagination footer', () => {
  const components = read('src/console/components.tsx')
  const hook = read('src/console/use-client-pagination.ts')
  const pages = [
    'src/features/agents/AgentsPage.tsx',
    'src/features/environments/EnvironmentsPage.tsx',
    'src/features/sessions/SessionsPage.tsx',
    'src/features/providers/ProvidersPage.tsx',
    'src/features/vaults/VaultsPage.tsx',
    'src/features/audit/AuditPage.tsx',
    'src/features/mcp/McpPage.tsx',
  ]
    .map(read)
    .join('\n')
  assert.match(components, /viewportRef/)
  assert.match(components, /TablePagination/)
  assert.match(hook, /useClientPagination/)
  assert.match(hook, /scrollTop = 0/)
  assert.match(pages, /useClientPagination/)
})

Then('resource list rows keep primary metadata on one line', () => {
  const views = [
    'src/features/agents/AgentsView.tsx',
    'src/features/environments/EnvironmentsView.tsx',
    'src/features/sessions/SessionsView.tsx',
    'src/features/providers/ProvidersView.tsx',
    'src/features/vaults/VaultsView.tsx',
    'src/features/mcp/McpView.tsx',
  ]
    .map(read)
    .join('\n')
  assert.match(views, /items-center gap-2/)
  assert.doesNotMatch(views, /mt-1/)
})

Then('provider and MCP error details use the shared tooltip surface', () => {
  const providers = read('src/features/providers/ProvidersView.tsx')
  const mcp = read('src/features/mcp/McpView.tsx')
  assert.match(providers, /detail=\{provider\.lastError \? stringifyJson\(provider\.lastError\) : null\}/)
  assert.match(mcp, /detail=\{connection\.lastError \? stringifyJson\(connection\.lastError\) : null\}/)
})
