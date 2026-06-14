// Pure provider business rules for the session runtime: provider-id
// canonicalization, the session provider config shape, and the session
// provider+model resolution. Reading the repo to resolve a provider config and
// translating it into the runtime env contract stay in the effectful
// provider-env module; only the pure shaping lives here.

export function isWorkersAiProvider(provider: string): boolean {
  return provider === 'workers-ai' || provider === 'cloudflare-workers-ai'
}

export function canonicalProvider(provider: string): string {
  return provider === 'workers-ai' ? 'cloudflare-workers-ai' : provider
}

export const PLATFORM_DEFAULT_PROVIDER = 'workers-ai'

export type SessionProviderConfig = {
  id: string
  type: string
  baseUrl: string | null
  credentialId: string | null
  credentialVersionId: string | null
}

export type SessionProviderResolution =
  | { ok: true; config: SessionProviderConfig | null }
  | { ok: false; reason: 'not_found' | 'unavailable' }

// Single source for the session's runtime provider + model. The session's pinned
// modelProvider wins; otherwise the agent snapshot's providerId (falling back to
// the platform default). The model prefers the session modelConfig, then the
// agent snapshot, else null (the engine resolves the provider default).
export function resolveSessionProviderModel(
  session: { modelProvider: string | null },
  agentSnapshot: Record<string, unknown>,
  modelConfig: Record<string, unknown>,
): { provider: string; model: string | null } {
  const provider =
    session.modelProvider ?? (typeof agentSnapshot.providerId === 'string' ? agentSnapshot.providerId : 'workers-ai')
  const model =
    typeof modelConfig.model === 'string'
      ? modelConfig.model
      : typeof agentSnapshot.model === 'string'
        ? agentSnapshot.model
        : null
  return { provider, model }
}
