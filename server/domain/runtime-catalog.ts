export const RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX = 'runtime-provider-model'

export type RuntimeHostingMode = 'cloud' | 'self_hosted'
export type RuntimeName = 'ama' | 'claude-code' | 'codex' | 'copilot'

type RuntimeCatalogEntry = {
  runtime: RuntimeName
  hostingModes: RuntimeHostingMode[]
  providerModels: Array<{ provider: string; model: string; displayName?: string }>
}

// Self-hosted CLI runtimes accept any model ('*'): the host CLI owns the
// model universe and a lease fails naturally if the host cannot serve it.
// Pinning a single id here rejected legitimate models (e.g. opus on
// claude-code) at session creation. Cloud stays pinned to platform models.
export const RUNTIME_CATALOG: readonly RuntimeCatalogEntry[] = [
  {
    runtime: 'ama',
    hostingModes: ['cloud', 'self_hosted'],
    // First entry is the default clients pick. kimi-k2.7-code is the working
    // primary (code-focused, healthy upstream); gpt-oss-120b is a
    // different-vendor backend that survives a moonshot-side outage; kimi-k2.6
    // is kept for when its upstream recovers. llama-3.3-70b was tried and
    // dropped: it returns no tool_calls in this harness, so it can't drive the
    // agentic loop.
    providerModels: [
      { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.7-code', displayName: 'Kimi K2.7 Code (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', displayName: 'GPT-OSS 120B (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6', displayName: 'Kimi K2.6 (Workers AI)' },
    ],
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

// Cloud runtime model catalog exposed to clients: only concrete platform models
// of a cloud-capable runtime. Self-hosted-only runtimes (wildcard '*' entries,
// not cloud) own their model universe at the host CLI, so they return [].
export function cloudRuntimeModels(
  runtime: RuntimeName,
): Array<{ provider: string; model: string; displayName?: string }> {
  const entry = RUNTIME_CATALOG.find((e) => e.runtime === runtime)
  if (!entry?.hostingModes.includes('cloud')) return []
  return entry.providerModels
    .filter((pm) => pm.model !== '*')
    .map((pm) => ({
      provider: pm.provider,
      model: pm.model,
      ...(pm.displayName ? { displayName: pm.displayName } : {}),
    }))
}

// Runtimes whose bridge reliably accepts mid-run prompt injection over the
// runner session channel. Only ama qualifies: it runs the shared runtime-core
// engine and loops a continuation turn per injected prompt. The SDK-session
// runtimes (claude-code, copilot) and the one-prompt-per-process runtime
// (codex) cannot — a prompt injected as a turn ends (e.g. a reject arriving
// right after the agent submitted review) races the SDK loop exit and is
// silently dropped. They queue a fresh resume work item instead, which the
// runner picks up as a new turn.
const LIVE_PROMPT_RUNTIMES: ReadonlySet<RuntimeName> = new Set(['ama'])

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
  // The `candidate.model === model` arm matches a wildcard-provider entry pinned
  // to a specific model; no current RUNTIME_CATALOG entry has that shape (every
  // wildcard-provider runtime is wildcard-model), so v8 cannot reach it — a
  // catalog-growth guard, not dead code.
  /* v8 ignore start */
  const wildcard = entry?.providerModels.find(
    (candidate) => candidate.provider === '*' && (candidate.model === '*' || candidate.model === model),
  )
  /* v8 ignore stop */
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
  /* v8 ignore start -- catalog-growth guard: no current RUNTIME_CATALOG entry declares zero providerModels */
  if (entry.providerModels.length === 0) {
    return true
  }
  /* v8 ignore stop */
  // Provider support is checked even when no model is pinned: a runtime that
  // only serves the platform provider (ama → workers-ai) must not accept a
  // configured external provider just because the agent left the model open.
  if (!model) {
    return entry.providerModels.some((capability) => capability.provider === '*' || capability.provider === provider)
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
