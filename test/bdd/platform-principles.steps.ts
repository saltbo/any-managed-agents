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

Then('the application must use Cloudflare-compatible platform services for runtime state', () => {
  const wrangler = read('wrangler.toml')
  assert.match(wrangler, /\[\[d1_databases\]\]/)
  assert.match(wrangler, /\[\[durable_objects\.bindings\]\]/)
})

Then('agent runtime traffic must use the Cloudflare Agent SDK protocol', () => {
  const app = read('server/app.ts')
  const agent = read('server/agents/managed-agent.ts')
  assert.match(app, /routeAgentRequest/)
  assert.match(agent, /from 'agents'/)
})

Then('the platform must not define a competing custom agent runtime SDK', () => {
  const packageJson = read('package.json')
  assert.doesNotMatch(packageJson, /"@any-managed-agents\/sdk"/)
})

Then('product APIs may exist only for control-plane resource management', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /The platform owns the control plane/)
  assert.match(spec, /The platform does not own a custom runtime SDK/)
})

Then('sandbox execution must use Cloudflare Sandbox SDK', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /Sandbox execution uses Cloudflare Sandbox SDK directly/)
})

Then('the platform must not define a competing custom sandbox SDK', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /does not maintain a competing client SDK/)
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

Then('the model layer must allow additional providers', () => {
  const spec = read('docs/product/spec.md')
  assert.match(spec, /model layer supports multiple providers/)
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
