export function isWorkersAiProvider(provider: string): boolean {
  return provider === 'workers-ai' || provider === 'cloudflare-workers-ai'
}

export function canonicalProvider(provider: string): string {
  return provider === 'workers-ai' ? 'cloudflare-workers-ai' : provider
}
