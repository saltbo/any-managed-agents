import type { RuntimeBridgeRequest, RuntimeProvider } from '../protocol'
import { claudeCodeProvider } from './claude-code'
import { codexProvider } from './codex'
import { copilotProvider } from './copilot'

const providers = new Map<RuntimeBridgeRequest['runtime'], RuntimeProvider>([
  [codexProvider.name, codexProvider],
  [claudeCodeProvider.name, claudeCodeProvider],
  [copilotProvider.name, copilotProvider],
])

export function getProvider(runtime: RuntimeBridgeRequest['runtime']) {
  const provider = providers.get(runtime)
  if (!provider) throw new Error(`Unsupported runtime provider: ${runtime}`)
  return provider
}

export function listProviders() {
  return Array.from(providers.values())
}
