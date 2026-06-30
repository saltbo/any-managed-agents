import type { RuntimeBridgeRunMessage, RuntimeProvider } from '../protocol'
import { claudeCodeProvider } from './claude-code'
import { codexProvider } from './codex'
import { copilotProvider } from './copilot'

const providers = new Map<RuntimeBridgeRunMessage['runtime'], RuntimeProvider>([
  [codexProvider.name, codexProvider],
  [claudeCodeProvider.name, claudeCodeProvider],
  [copilotProvider.name, copilotProvider],
])

export function getProvider(runtime: RuntimeBridgeRunMessage['runtime']) {
  const provider = providers.get(runtime)
  if (!provider) throw new Error(`Unsupported runtime provider: ${runtime}`)
  return provider
}

export function listProviders() {
  return Array.from(providers.values())
}
