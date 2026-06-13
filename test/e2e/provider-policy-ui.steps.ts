import assert from 'node:assert/strict'
import { Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import {
  createAgent,
  createEnvironment,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'
const ACCESS_RULES_API = '/api/v1/access-rules'

type PolicyUiWorld = StepsWorld & {
  validationMessageSeen?: boolean
  rulesAfterInvalidSubmit?: number
  savedRuleReason?: string
}

When('the user edits provider access or policy settings', async function (this: PolicyUiWorld) {
  const state = await ensureSignedIn(this)
  const { page } = state
  const rulesLoaded = page.waitForResponse(
    (response) => response.url().includes(ACCESS_RULES_API) && response.request().method() === 'GET',
  )
  await page.goto('/providers/policy')
  await rulesLoaded
  await page.getByRole('button', { name: 'Add access rule' }).click()

  // First attempt: no provider or model target. The form must block the
  // save client-side instead of sending an invalid rule.
  await page.getByRole('button', { name: 'Save access rule' }).click()
  await page.getByText('An access rule must target a provider id, a model id, or both.').waitFor()
  this.validationMessageSeen = true
  const rulesAfterInvalid = await apiJson<ListResponse<Json>>(page.request, ACCESS_RULES_API)
  this.rulesAfterInvalidSubmit = rulesAfterInvalid.data.length

  // Second attempt: a valid deny rule for the Workers AI provider.
  this.savedRuleReason = `${state.runId} denied from the policy console`
  await page.locator('#field-provider-id').fill('workers-ai')
  await page.locator('#field-reason').fill(this.savedRuleReason)
  const ruleSaved = page.waitForResponse(
    (response) => response.url().includes(ACCESS_RULES_API) && response.request().method() === 'POST',
  )
  const rulesReloaded = page.waitForResponse(
    (response) => response.url().includes(ACCESS_RULES_API) && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: 'Save access rule' }).click()
  const saveResponse = await ruleSaved
  assert.equal(saveResponse.status(), 201, 'the console saved the access rule through the control plane')
  await rulesReloaded
  await page.getByText(this.savedRuleReason).waitFor()
})

Then('the UI validates the change before saving', async function (this: PolicyUiWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  assert.equal(this.validationMessageSeen, true, 'the form surfaced a validation error before saving')
  assert.equal(this.rulesAfterInvalidSubmit, 0, 'the invalid submit never reached the control plane')
  const rules = await apiJson<ListResponse<Json>>(state.page.request, ACCESS_RULES_API)
  assert.equal(rules.data.length, 1, 'only the valid rule was saved')
  const rule = rules.data[0] as Json
  assert.equal(rule.providerId, 'workers-ai', 'the saved rule targets the provider entered in the form')
  assert.equal(rule.effect, 'deny', 'the saved rule keeps the selected effect')
  assert.equal(rule.reason, this.savedRuleReason, 'the saved rule keeps the entered reason')
})

Then('the saved policy affects later sessions', async function (this: PolicyUiWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const agent = await createAgent(state, {
    name: `${state.runId} policy ui agent`,
    model: WORKERS_AI_MODEL,
  })
  const environment = await createEnvironment(state, { name: `${state.runId} policy ui env` })
  const response = await apiResponse(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: agent.id,
      environmentId: environment.id,
      runtime: 'ama',
      title: `${state.runId} policy ui session`,
    },
  })
  assert.equal(response.status(), 403, 'a later session against the denied provider is rejected')
  const body = (await response.json()) as Json
  const error = (body.error ?? {}) as Json
  assert.equal(error.type, 'policy_denied', 'the rejection uses the structured policy error envelope')
  assert.ok(String(error.message).includes(String(this.savedRuleReason)), 'the rejection cites the console-saved rule')
})
