export const RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX = 'runtime-provider-model'

export type RuntimeHostingMode = 'cloud' | 'self_hosted'
export type RuntimeName = 'ama' | 'claude-code' | 'codex' | 'copilot'

type RuntimeCatalogEntry = {
  runtime: RuntimeName
  hostingModes: RuntimeHostingMode[]
  providerModels: Array<{ provider: string; model: string }>
}

// Self-hosted CLI runtimes accept any model ('*'): the host CLI owns the
// model universe and a lease fails naturally if the host cannot serve it.
// Pinning a single id here rejected legitimate models (e.g. opus on
// claude-code) at session creation. Cloud stays pinned to platform models.
export const RUNTIME_CATALOG: readonly RuntimeCatalogEntry[] = [
  {
    runtime: 'ama',
    hostingModes: ['cloud', 'self_hosted'],
    providerModels: [{ provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6' }],
  },
  {
    runtime: 'claude-code',
    hostingModes: ['self_hosted'],
    providerModels: [{ provider: '*', model: '*' }],
  },
  {
    runtime: 'codex',
    hostingModes: ['self_hosted'],
    providerModels: [{ provider: '*', model: '*' }],
  },
  {
    runtime: 'copilot',
    hostingModes: ['self_hosted'],
    providerModels: [{ provider: '*', model: '*' }],
  },
]

// Runtimes whose bridge accepts mid-run prompt injection over the runner
// session channel. codex runs one prompt per process, so live prompts are not
// supported there and session commands must queue as new work items.
const LIVE_PROMPT_RUNTIMES: ReadonlySet<RuntimeName> = new Set(['claude-code', 'copilot'])

export function runtimeSupportsLivePrompts(runtime: RuntimeName) {
  return LIVE_PROMPT_RUNTIMES.has(runtime)
}

export function runtimeProviderModelCapability(runtime: RuntimeName, provider: string, model: string) {
  return `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:${provider}:${model}`
}

export function runtimeRequiredRunnerCapability(runtime: RuntimeName, provider: string, model?: string | null) {
  if (!model) {
    return runtime
  }
  const entry = RUNTIME_CATALOG.find((item) => item.runtime === runtime)
  // Wildcard-provider entries (including wildcard-model ones) normalize the
  // provider segment to '*': runners enumerate host models without knowing
  // platform provider ids, so they declare '*' as the provider.
  const wildcard = entry?.providerModels.find(
    (candidate) => candidate.provider === '*' && (candidate.model === '*' || candidate.model === model),
  )
  return runtimeProviderModelCapability(runtime, wildcard ? '*' : provider, model)
}

// TRANSITIONAL: runners deployed before host model enumeration declare the
// bare runtime name plus a single hardcoded model, so the specific model
// capability may be missing even though the host CLI serves the model. For
// wildcard-model runtimes the bare runtime capability therefore still counts
// as model support. Removable once the runner fleet advertises enumerated
// per-model capabilities.
export function transitionalRuntimeLevelRuntimes(): RuntimeName[] {
  return RUNTIME_CATALOG.filter((entry) => entry.providerModels.some((candidate) => candidate.model === '*')).map(
    (entry) => entry.runtime,
  )
}

export function runnerSupportsRuntimeProviderModel(
  capabilities: string[],
  runtime: RuntimeName,
  provider: string,
  model?: string | null,
) {
  if (!model) {
    return (
      capabilities.includes(runtime) ||
      capabilities.some((capability) =>
        capability.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:`),
      )
    )
  }
  if (
    capabilities.includes(runtimeProviderModelCapability(runtime, provider, model)) ||
    capabilities.includes(runtimeProviderModelCapability(runtime, '*', model))
  ) {
    return true
  }
  // TRANSITIONAL fallback — see transitionalRuntimeLevelRuntimes.
  return transitionalRuntimeLevelRuntimes().includes(runtime) && capabilities.includes(runtime)
}

export function runtimeCatalogSupportsProviderModel(
  hostingMode: RuntimeHostingMode,
  runtime: RuntimeName,
  provider: string,
  model?: string | null,
) {
  const entry = RUNTIME_CATALOG.find((item) => item.runtime === runtime)
  if (!entry?.hostingModes.includes(hostingMode)) {
    return false
  }
  if (!model) {
    return true
  }
  if (entry.providerModels.length === 0) {
    return true
  }
  return Boolean(
    entry.providerModels.some(
      (capability) =>
        (capability.provider === '*' || capability.provider === provider) &&
        (capability.model === '*' || capability.model === model),
    ),
  )
}

export function runtimeSupportsHostingMode(hostingMode: RuntimeHostingMode, runtime: RuntimeName) {
  return RUNTIME_CATALOG.some((entry) => entry.runtime === runtime && entry.hostingModes.includes(hostingMode))
}
