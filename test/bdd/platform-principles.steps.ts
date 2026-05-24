import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Given, Then } from '@cucumber/cucumber'

function read(path: string) {
  return readFileSync(path, 'utf8')
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
  assert.match(deploy, /AMA_WORKERS_AI_API_KEY/)
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
  const api = read('src/lib/api.ts')
  const forms = read('src/console/forms.tsx')
  const views = read('src/console/views.tsx')
  const components = read('src/console/components.tsx')
  assert.match(app, /QueryClientProvider/)
  assert.match(app, /RouterProvider/)
  assert.match(router, /createBrowserRouter/)
  assert.match(router, /AgentsPage/)
  assert.match(router, /EnvironmentsPage/)
  assert.match(router, /SessionsPage/)
  assert.match(layout, /useQuery/)
  assert.match(layout, /useMutation/)
  assert.match(layout, /viewFromPath/)
  assert.match(layout, /@\/components\/ui\/button/)
  assert.match(layout, /@\/components\/ui\/sheet/)
  assert.match(forms, /@\/components\/ui\/input/)
  assert.match(forms, /@\/components\/ui\/select/)
  assert.match(views, /@\/components\/ui\/card/)
  assert.match(views, /@\/components\/ui\/scroll-area/)
  assert.match(components, /@\/components\/ui\/badge/)
  assert.match(layout, /createMode/)
  assert.doesNotMatch(layout, /Acceptance Path/)
  assert.match(layout, /startAgentSession/)
  assert.match(api, /createEnvironment/)
  assert.match(api, /createAgent/)
  assert.match(api, /createSession/)
})

Then('the v1 web console can send runtime tasks and inspect session events', () => {
  const views = read('src/console/views.tsx')
  const api = read('src/lib/api.ts')
  assert.match(views, /Send task/)
  assert.match(views, /Transcript and runtime events/)
  assert.match(api, /sendRuntimeTask/)
  assert.match(api, /listSessionEvents/)
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
    const productViews = read('src/console/views.tsx')
    assert.match(app, /QueryClientProvider/)
    assert.match(app, /RouterProvider/)
    assert.doesNotMatch(app, /AgentsView|EnvironmentForm|SessionsView|useQuery|useMutation/)
    assert.match(router, /createBrowserRouter/)
    assert.match(router, /AgentsPage/)
    assert.match(router, /EnvironmentsPage/)
    assert.match(router, /SessionsPage/)
    assert.match(layout, /ConsoleContextProvider/)
    assert.match(agentsPage, /useConsoleContext/)
    assert.match(environmentsPage, /useConsoleContext/)
    assert.match(sessionsPage, /useConsoleContext/)
    assert.match(productComponents, /StatusBadge/)
    assert.match(productViews, /AgentsView/)
  },
)

Then('the web console uses React Query for server state instead of feature-level ad hoc loading loops', () => {
  const layout = read('src/features/console/ConsoleLayout.tsx')
  const agentsPage = read('src/features/agents/AgentsPage.tsx')
  const environmentsPage = read('src/features/environments/EnvironmentsPage.tsx')
  const sessionsPage = read('src/features/sessions/SessionsPage.tsx')
  assert.match(layout, /useQuery/)
  assert.match(layout, /useMutation/)
  assert.match(layout, /invalidateQueries/)
  assert.doesNotMatch(agentsPage, /useEffect|fetch\(/)
  assert.doesNotMatch(environmentsPage, /useEffect|fetch\(/)
  assert.doesNotMatch(sessionsPage, /useEffect|fetch\(/)
})

Then('console pages compose shadcn primitives instead of legacy custom global component classes', () => {
  const styles = read('src/styles.css')
  const forms = read('src/console/forms.tsx')
  const views = read('src/console/views.tsx')
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
  const views = read('src/console/views.tsx')
  const field = read('src/components/ui/field.tsx')
  const standards = read('docs/product/ui-ux-standards.md')
  assert.match(field, /FieldGroup/)
  assert.match(forms, /@\/components\/ui\/field/)
  assert.match(forms, /FieldGroup/)
  assert.match(forms, /FieldLabel/)
  assert.match(forms, /FieldDescription/)
  assert.match(views, /@\/components\/ui\/field/)
  assert.match(views, /FieldLabel htmlFor="runtime-task"/)
  assert.match(
    standards,
    /Forms must use shadcn `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, and `FieldError`/,
  )
  assert.doesNotMatch(forms, /from '\.\/components'/)
  assert.doesNotMatch(forms, /className="space-y-|className="grid gap-1\.5"|<label className=/)
})

Then('console date and time rendering uses the shared dayjs formatter', () => {
  const packageJson = read('package.json')
  const format = read('src/console/format.ts')
  const views = read('src/console/views.tsx')
  assert.match(packageJson, /"dayjs":/)
  assert.match(format, /from 'dayjs'/)
  assert.match(format, /dayjs\(value\)\.format/)
  assert.doesNotMatch(views, /Intl\.DateTimeFormat|new Date\(/)
})

Then('destructive console actions require the shared confirmation dialog', () => {
  const alertDialog = read('src/components/ui/alert-dialog.tsx')
  const components = read('src/console/components.tsx')
  const views = read('src/console/views.tsx')
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

Then('the UI\\/UX standards are indexed with the product specs', () => {
  const index = read('specs/product/spec-index.md')
  assert.match(index, /ui-ux-standards\.feature/)
  assert.match(index, /shared console UI\/UX standards/)
})
