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
  const api = read('src/lib/api.ts')
  assert.match(app, /Create Environment/)
  assert.match(app, /Create Agent/)
  assert.match(app, /startAgentSession/)
  assert.match(api, /createEnvironment/)
  assert.match(api, /createAgent/)
  assert.match(api, /createSession/)
})

Then('the v1 web console can send runtime tasks and inspect session events', () => {
  const app = read('src/App.tsx')
  const api = read('src/lib/api.ts')
  assert.match(app, /Send task/)
  assert.match(app, /Transcript and runtime events/)
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
