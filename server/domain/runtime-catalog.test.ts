import { describe, expect, it } from 'vitest'
import {
  RUNTIME_CATALOG,
  RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX,
  runnerSupportsRuntimeProviderModel,
  runtimeCatalogSupportsProviderModel,
  runtimeProviderModelCapability,
  runtimeRequiredRunnerCapability,
  runtimeSupportsHostingMode,
  runtimeSupportsLivePrompts,
  transitionalRuntimeLevelRuntimes,
} from './runtime-catalog'

describe('runtimeSupportsLivePrompts', () => {
  it('returns true only for ama, which loops a continuation turn per injected prompt', () => {
    expect(runtimeSupportsLivePrompts('ama')).toBe(true)
  })

  it('returns false for SDK-session and one-shot runtimes, which queue a resume work item', () => {
    // claude-code/copilot resume an SDK session and codex runs one prompt per
    // process: a prompt injected as a turn ends races the loop exit and is
    // dropped, so they must queue a fresh resume work item instead.
    expect(runtimeSupportsLivePrompts('claude-code')).toBe(false)
    expect(runtimeSupportsLivePrompts('copilot')).toBe(false)
    expect(runtimeSupportsLivePrompts('codex')).toBe(false)
  })
})

describe('runtimeProviderModelCapability', () => {
  it('constructs a capability string from runtime, provider, and model', () => {
    expect(runtimeProviderModelCapability('ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')).toBe(
      `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:ama:workers-ai:@cf/moonshotai/kimi-k2.6`,
    )
  })

  it('constructs a wildcard capability for self-hosted runtimes', () => {
    expect(runtimeProviderModelCapability('claude-code', '*', '*')).toBe(
      `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:claude-code:*:*`,
    )
  })
})

describe('runtimeRequiredRunnerCapability', () => {
  it('returns just the runtime name when model is absent', () => {
    expect(runtimeRequiredRunnerCapability('ama', 'workers-ai', null)).toBe('ama')
    expect(runtimeRequiredRunnerCapability('ama', 'workers-ai', undefined)).toBe('ama')
  })

  it('normalizes provider to wildcard for wildcard-provider catalog entries', () => {
    // claude-code has providerModels with provider: '*', so capability uses '*' as provider
    expect(runtimeRequiredRunnerCapability('claude-code', 'anthropic', 'claude-opus-4')).toBe(
      runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4'),
    )
  })

  it('normalizes provider to wildcard for wildcard-model catalog entries', () => {
    // codex and copilot also have provider:'*' and model:'*'
    expect(runtimeRequiredRunnerCapability('codex', 'openai', 'gpt-4o')).toBe(
      runtimeProviderModelCapability('codex', '*', 'gpt-4o'),
    )
  })

  it('normalizes ama to a wildcard provider (the catalog no longer pins models)', () => {
    expect(runtimeRequiredRunnerCapability('ama', 'moonshotai', '@cf/moonshotai/kimi-k2.6')).toBe(
      runtimeProviderModelCapability('ama', '*', '@cf/moonshotai/kimi-k2.6'),
    )
  })

  it('uses the concrete provider when no catalog entry matches', () => {
    // @ts-expect-error testing unknown runtime
    expect(runtimeRequiredRunnerCapability('unknown-runtime', 'some-provider', 'some-model')).toBe(
      `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:unknown-runtime:some-provider:some-model`,
    )
  })
})

describe('transitionalRuntimeLevelRuntimes', () => {
  it('returns all runtimes whose catalog entry uses a wildcard model', () => {
    const names = transitionalRuntimeLevelRuntimes()
    // Every runtime now declares a wildcard model (ama validates against the
    // global catalog instead of a pinned list), so all of them appear.
    expect(names).toContain('ama')
    expect(names).toContain('claude-code')
    expect(names).toContain('codex')
    expect(names).toContain('copilot')
  })
})

describe('runnerSupportsRuntimeProviderModel', () => {
  const CLAUDE_CAP = runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4')
  const AMA_CAP = runtimeProviderModelCapability('ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')

  it('returns true when no model given and runner declares the bare runtime name', () => {
    expect(runnerSupportsRuntimeProviderModel(['claude-code'], 'claude-code', 'anthropic')).toBe(true)
  })

  it('returns true when no model given and runner declares a matching runtime-provider-model capability', () => {
    expect(runnerSupportsRuntimeProviderModel([CLAUDE_CAP], 'claude-code', 'anthropic')).toBe(true)
  })

  it('returns false when no model given and runner has no matching capability', () => {
    expect(runnerSupportsRuntimeProviderModel([AMA_CAP], 'claude-code', 'anthropic')).toBe(false)
  })

  it('returns true when runner capabilities include the exact model capability', () => {
    expect(runnerSupportsRuntimeProviderModel([CLAUDE_CAP], 'claude-code', '*', 'claude-opus-4')).toBe(true)
  })

  it('returns true when runner capabilities include a wildcard-provider model capability', () => {
    const wildcard = runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4')
    expect(runnerSupportsRuntimeProviderModel([wildcard], 'claude-code', 'anthropic', 'claude-opus-4')).toBe(true)
  })

  it('uses transitional bare-runtime fallback for wildcard-model runtimes', () => {
    // claude-code is a wildcard-model runtime, so bare capability counts
    expect(runnerSupportsRuntimeProviderModel(['claude-code'], 'claude-code', 'anthropic', 'claude-opus-4')).toBe(true)
  })

  it('applies transitional bare-runtime fallback for ama (now a wildcard runtime)', () => {
    // ama is a wildcard-model runtime now, so bare 'ama' grants model-specific work
    expect(runnerSupportsRuntimeProviderModel(['ama'], 'ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')).toBe(true)
  })

  it('returns false when model is given but runner has no matching capability', () => {
    expect(runnerSupportsRuntimeProviderModel([AMA_CAP], 'claude-code', 'anthropic', 'claude-opus-4')).toBe(false)
  })
})

describe('runtimeCatalogSupportsProviderModel', () => {
  it('returns false when the runtime does not support the requested hosting mode', () => {
    // claude-code only supports self_hosted, not cloud
    expect(runtimeCatalogSupportsProviderModel('cloud', 'claude-code', 'anthropic', 'claude-opus-4')).toBe(false)
  })

  it('accepts any provider/model on ama cloud (catalog is wildcard; the global catalog validates)', () => {
    // ama no longer pins models here — the loose catalog filter accepts anything,
    // and provisioning validates cloud provider/model against the global catalog.
    expect(runtimeCatalogSupportsProviderModel('cloud', 'ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('cloud', 'ama', 'anthropic', 'anthropic/claude-opus-4')).toBe(true)
  })

  it('returns true for any provider/model on a wildcard-model self-hosted runtime', () => {
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'claude-code', 'anthropic', 'claude-opus-4')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'codex', 'openai', 'gpt-4o')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'copilot', 'azure', 'gpt-4.1')).toBe(true)
  })

  it('accepts any provider on a wildcard runtime even when no model is given', () => {
    expect(runtimeCatalogSupportsProviderModel('cloud', 'ama', 'anthropic')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'claude-code', 'anthropic')).toBe(true)
  })

  it('returns false for an unknown runtime', () => {
    // @ts-expect-error testing unknown runtime
    expect(runtimeCatalogSupportsProviderModel('cloud', 'unknown', 'any', 'any')).toBe(false)
  })
})

describe('runtimeSupportsHostingMode', () => {
  it('returns true when the runtime supports the hosting mode', () => {
    expect(runtimeSupportsHostingMode('cloud', 'ama')).toBe(true)
    expect(runtimeSupportsHostingMode('self_hosted', 'ama')).toBe(true)
    expect(runtimeSupportsHostingMode('self_hosted', 'claude-code')).toBe(true)
  })

  it('returns false when the runtime does not support the hosting mode', () => {
    expect(runtimeSupportsHostingMode('cloud', 'claude-code')).toBe(false)
    expect(runtimeSupportsHostingMode('cloud', 'codex')).toBe(false)
    expect(runtimeSupportsHostingMode('cloud', 'copilot')).toBe(false)
  })

  it('returns false for unknown runtimes', () => {
    // @ts-expect-error testing unknown runtime
    expect(runtimeSupportsHostingMode('cloud', 'unknown')).toBe(false)
  })
})

describe('RUNTIME_CATALOG integrity', () => {
  it('contains the expected four runtimes', () => {
    const runtimes = RUNTIME_CATALOG.map((entry) => entry.runtime)
    expect(runtimes).toContain('ama')
    expect(runtimes).toContain('claude-code')
    expect(runtimes).toContain('codex')
    expect(runtimes).toContain('copilot')
  })
})
