import { describe, expect, it } from 'vitest'
import { runtimeProviderModelCapability } from '../runtime/catalog'
import {
  environmentIdForRegistration,
  hasSecretMaterial,
  type RunnerOidcContext,
  runnerAuthModeForRegistration,
  runnerCapabilityEligible,
  runnerMachineId,
  runnerOidcBindingFields,
  runnerRuntimeReady,
} from './runner-queue'

const CLAUDE_CAP = runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4')
const AMA_CAP = runtimeProviderModelCapability('ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')

function oidc(overrides: Partial<RunnerOidcContext> = {}): RunnerOidcContext {
  return {
    isRunnerToken: false,
    subject: 'sub_1',
    clientId: null,
    runnerProjectId: null,
    runnerEnvironmentId: null,
    externalTenantId: null,
    ...overrides,
  }
}

describe('runnerCapabilityEligible', () => {
  it('claims unscoped non-session work for any runner', () => {
    expect(runnerCapabilityEligible([], { type: 'maintenance' })).toBe(true)
  })

  it('rejects session starts that declare no required capability', () => {
    expect(runnerCapabilityEligible(['node'], { type: 'session.start' })).toBe(false)
  })

  it('matches the exact required capability', () => {
    expect(runnerCapabilityEligible([AMA_CAP], { type: 'session.start', requiredRunnerCapability: AMA_CAP })).toBe(true)
  })

  it('rejects when the required capability is absent', () => {
    expect(runnerCapabilityEligible([AMA_CAP], { type: 'session.start', requiredRunnerCapability: CLAUDE_CAP })).toBe(
      false,
    )
  })

  it('lets a bare wildcard-runtime capability claim model-specific work (transitional)', () => {
    expect(
      runnerCapabilityEligible(['claude-code'], { type: 'session.start', requiredRunnerCapability: CLAUDE_CAP }),
    ).toBe(true)
  })
})

describe('runnerRuntimeReady', () => {
  it('passes when the runner reports no inventory yet', () => {
    expect(runnerRuntimeReady([], { type: 'session.start', requiredRunnerCapability: CLAUDE_CAP })).toBe(true)
  })

  it('passes unscoped work regardless of inventory', () => {
    expect(runnerRuntimeReady([{ runtime: 'codex', state: 'unhealthy' }], { type: 'maintenance' })).toBe(true)
  })

  it('requires a ready inventory entry for the required runtime', () => {
    expect(
      runnerRuntimeReady([{ runtime: 'claude-code', state: 'unauthenticated' }], {
        type: 'session.start',
        requiredRunnerCapability: CLAUDE_CAP,
      }),
    ).toBe(false)
    expect(
      runnerRuntimeReady([{ runtime: 'claude-code', state: 'ready' }], {
        type: 'session.start',
        requiredRunnerCapability: CLAUDE_CAP,
      }),
    ).toBe(true)
  })
})

describe('hasSecretMaterial', () => {
  it('flags secret-shaped keys but not plain operator metadata', () => {
    expect(hasSecretMaterial({ apiKey: 'x' })).toBe(true)
    expect(hasSecretMaterial({ access_token: 'x' })).toBe(true)
    expect(hasSecretMaterial({ nested: [{ password: 'x' }] })).toBe(true)
    expect(hasSecretMaterial({ pool: 'default', machineId: 'mac-1' })).toBe(false)
  })
})

describe('runner registration binding', () => {
  it('defaults the auth mode from the token binding', () => {
    expect(runnerAuthModeForRegistration(oidc(), undefined)).toBe('oidc')
    expect(runnerAuthModeForRegistration(oidc({ runnerProjectId: 'project_1' }), undefined)).toBe('federated')
    expect(runnerAuthModeForRegistration(oidc(), 'bearer')).toBe('bearer')
  })

  it('overrides the environment with the federated token binding', () => {
    expect(environmentIdForRegistration(oidc({ runnerEnvironmentId: 'env_bound' }), 'env_req')).toBe('env_bound')
    expect(environmentIdForRegistration(oidc(), 'env_req')).toBe('env_req')
  })

  it('rejects a device-login token registering a non-oidc runner', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, clientId: 'cid' }), 'bearer')).toMatchObject({
      authMode: expect.stringContaining('device-login'),
    })
  })

  it('rejects a federated token registering a non-federated runner', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, runnerProjectId: 'project_1' }), 'oidc')).toMatchObject({
      authMode: expect.stringContaining('Federated'),
    })
  })

  it('accepts a console (non-runner) token for any mode', () => {
    expect(runnerOidcBindingFields(oidc(), 'bearer')).toBeNull()
  })

  it('reads a trimmed machine id from metadata', () => {
    expect(runnerMachineId({ machineId: '  mac-1 ' })).toBe('mac-1')
    expect(runnerMachineId({ machineId: '' })).toBeNull()
    expect(runnerMachineId(undefined)).toBeNull()
  })
})
