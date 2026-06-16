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
    // The cloud runtime calls env.AI.run(model), where provider is always
    // 'workers-ai' (the AI binding): an '@cf/...' id runs a native Workers AI
    // model; a '{vendor}/{model}' id (anthropic/openai/...) auto-routes through
    // AI Gateway to that vendor. First entry = the default clients pick — kept a
    // free @cf model so the default never incurs gateway billing.
    //
    // @cf models: free daily allocation; tool_calls verified in this harness
    // (probed via the runtime-ai proxy). Excluded the @cf ones that returned no
    // tool_calls (llama-3.1/3.3/4-scout, qwen2.5-coder, qwq-32b, deepseek-r1,
    // gemma-sea-lion). kimi-k2.6 last — its upstream is currently degraded.
    //
    // Third-party (anthropic/openai): ids verified valid against the gateway;
    // they bill via AI Gateway Unified Billing or BYOK (NOT the free @cf
    // allocation) — native tool-callers, per-model run pending gateway funding.
    providerModels: [
      { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.7-code', displayName: 'Kimi K2.7 Code (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', displayName: 'GPT-OSS 120B (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/openai/gpt-oss-20b', displayName: 'GPT-OSS 20B (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/qwen/qwen3-30b-a3b-fp8', displayName: 'Qwen3 30B A3B (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/nvidia/nemotron-3-120b-a12b', displayName: 'Nemotron 3 120B (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/google/gemma-4-26b-a4b-it', displayName: 'Gemma 4 26B (Workers AI)' },
      { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', displayName: 'GLM 4.7 Flash (Workers AI)' },
      {
        provider: 'workers-ai',
        model: '@cf/ibm-granite/granite-4.0-h-micro',
        displayName: 'Granite 4.0 H Micro (Workers AI)',
      },
      { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6', displayName: 'Kimi K2.6 (Workers AI)' },
      // Third-party via AI Gateway (Unified Billing / BYOK; not free):
      { provider: 'workers-ai', model: 'anthropic/claude-opus-4', displayName: 'Claude Opus 4 (Anthropic)' },
      { provider: 'workers-ai', model: 'anthropic/claude-sonnet-4', displayName: 'Claude Sonnet 4 (Anthropic)' },
      { provider: 'workers-ai', model: 'anthropic/claude-fable-5', displayName: 'Claude Fable 5 (Anthropic)' },
      { provider: 'workers-ai', model: 'openai/gpt-5.2', displayName: 'GPT-5.2 (OpenAI)' },
      { provider: 'workers-ai', model: 'openai/gpt-5', displayName: 'GPT-5 (OpenAI)' },
      { provider: 'workers-ai', model: 'openai/gpt-5-mini', displayName: 'GPT-5 mini (OpenAI)' },
      { provider: 'workers-ai', model: 'openai/gpt-4.1', displayName: 'GPT-4.1 (OpenAI)' },
      { provider: 'workers-ai', model: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 mini (OpenAI)' },
      { provider: 'workers-ai', model: 'openai/gpt-4o', displayName: 'GPT-4o (OpenAI)' },
      { provider: 'workers-ai', model: 'openai/o3', displayName: 'o3 (OpenAI)' },
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

export const DEFAULT_AI_GATEWAY_ID = 'ama'

// Pure cloud-model routing rule. Third-party ({vendor}/{model}) cloud models
// bill through AI Gateway and must name a gateway (configurable, default 'ama').
// '@cf/' models stay gateway-free: they run on the free Workers AI allocation,
// and forcing a not-yet-created named gateway returns 400 for them too. The
// effectful env read stays at the call sites (adapter egress + the runtime-ai
// proxy); this seam only decides which gateway routes a given model id.
export function aiGatewayFor(modelId: string, gatewayId: string | undefined) {
  return modelId.startsWith('@cf/') ? undefined : { id: gatewayId || DEFAULT_AI_GATEWAY_ID }
}
