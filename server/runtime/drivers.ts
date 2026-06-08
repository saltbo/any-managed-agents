import type { Env } from '../env'
import {
  type RuntimeHostingMode,
  type RuntimeName,
  runtimeCatalogSupportsProviderModel,
  runtimeSupportsHostingMode,
} from './catalog'
import {
  type SessionRuntimeStartInput,
  type SessionRuntimeStartResult,
  startSessionRuntime as startAmaCloudSessionRuntime,
} from './session-runtime'

export type RuntimeDriver = {
  runtime: RuntimeName
  cloudBackend: string | null
  cloudProtocol: string | null
  supportsHostingMode: (hostingMode: RuntimeHostingMode) => boolean
  supportsCloudProviderModel: (provider: string, model: string | null) => boolean
  startCloudSession?: (env: Env, input: SessionRuntimeStartInput) => Promise<SessionRuntimeStartResult>
}

const SELF_HOSTED_ONLY_DRIVERS = ['claude-code', 'codex', 'copilot'] as const

const AMA_DRIVER: RuntimeDriver = {
  runtime: 'ama',
  cloudBackend: 'ama-cloud',
  cloudProtocol: 'ama-runtime-rpc',
  supportsHostingMode: (hostingMode) => runtimeSupportsHostingMode(hostingMode, 'ama'),
  supportsCloudProviderModel: (provider, model) => runtimeCatalogSupportsProviderModel('cloud', 'ama', provider, model),
  startCloudSession: startAmaCloudSessionRuntime,
}

const SELF_HOSTED_DRIVERS: RuntimeDriver[] = SELF_HOSTED_ONLY_DRIVERS.map((runtime) => ({
  runtime,
  cloudBackend: null,
  cloudProtocol: null,
  supportsHostingMode: (hostingMode) => runtimeSupportsHostingMode(hostingMode, runtime),
  supportsCloudProviderModel: () => false,
}))

export const RUNTIME_DRIVERS: readonly RuntimeDriver[] = [AMA_DRIVER, ...SELF_HOSTED_DRIVERS]

export function runtimeDriver(runtime: RuntimeName) {
  const driver = RUNTIME_DRIVERS.find((candidate) => candidate.runtime === runtime)
  if (!driver) {
    throw new Error(`Unsupported runtime driver: ${runtime}`)
  }
  return driver
}

export function runtimeDriverName(runtime: RuntimeName, hostingMode: RuntimeHostingMode) {
  return hostingMode === 'cloud' ? runtimeDriver(runtime).cloudBackend : `${runtime}-self-hosted`
}

export function runtimeMetadata(values: {
  hostingMode: RuntimeHostingMode
  runtime: RuntimeName
  runtimeConfig: Record<string, unknown>
  provider: string
  model: string | null
  metadata?: Record<string, unknown>
}) {
  const driver = runtimeDriver(values.runtime)
  const metadata = values.metadata ?? {}
  const runtimeDriverValue =
    typeof metadata.runtimeDriver === 'string'
      ? metadata.runtimeDriver
      : runtimeDriverName(values.runtime, values.hostingMode)
  const runtimeBackend =
    typeof metadata.runtimeBackend === 'string'
      ? metadata.runtimeBackend
      : values.hostingMode === 'cloud'
        ? driver.cloudBackend
        : null
  const runtimeProtocol =
    typeof metadata.runtimeProtocol === 'string'
      ? metadata.runtimeProtocol
      : typeof metadata.runnerProtocol === 'string'
        ? metadata.runnerProtocol
        : values.hostingMode === 'cloud'
          ? driver.cloudProtocol
          : null
  return {
    hostingMode: values.hostingMode,
    runtime: values.runtime,
    runtimeConfig: values.runtimeConfig,
    provider: values.provider,
    model: values.model,
    driver: runtimeDriverValue,
    backend: runtimeBackend,
    protocol: runtimeProtocol,
  }
}
