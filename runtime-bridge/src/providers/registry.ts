import { amaProvider } from './ama'
import { claudeCodeProvider } from './claude-code'
import { codexProvider } from './codex'
import { copilotProvider } from './copilot'
import type { RuntimeBridgeRequest, RuntimeProvider } from '../protocol'

const providers = new Map<RuntimeBridgeRequest['runtime'], RuntimeProvider>([
  [amaProvider.name, amaProvider],
  [codexProvider.name, codexProvider],
  [claudeCodeProvider.name, claudeCodeProvider],
  [copilotProvider.name, copilotProvider],
])

export function getProvider(runtime: RuntimeBridgeRequest['runtime']) {
  const provider = providers.get(runtime)
  if (!provider) throw new Error(`Unsupported runtime provider: ${runtime}`)
  return provider
}
