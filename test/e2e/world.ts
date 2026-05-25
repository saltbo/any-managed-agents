import { setWorldConstructor, World } from '@cucumber/cucumber'
import type {
  RestishDiscoveryResult,
  RestishJsonOutputResult,
  RestishOpenApiHarness,
  RestishWorkflowResult,
} from '../../scripts/restish-openapi-contract'
import type { createApp } from '../../server/app'

export interface StagingSmokeEvidence {
  authenticated: boolean
  environmentId: string
  agentId: string
  sessionId: string
  completedTurns: number
  sawToolEvent: boolean
  sawToolUi: boolean
  sawErrorEvent: boolean
  sawErrorUi: boolean
  sawDebugUi: boolean
  replayDedupeOk: boolean
  persistedDedupeOk: boolean
}

export interface StagingSmokeConfig {
  effectiveStorageState?: string
  loginEmail?: string
  loginPassword?: string
  origin: string
  runId: string
  sessionCookie?: string
}

export class AmaWorld extends World {
  app: ReturnType<typeof createApp> | undefined
  response: Response | undefined
  openApiDocument: unknown
  restishDiscovery: RestishDiscoveryResult | undefined
  restishHarness: RestishOpenApiHarness | undefined
  restishJsonOutput: RestishJsonOutputResult | undefined
  restishWorkflow: RestishWorkflowResult | undefined
  stagingSmokeConfig: StagingSmokeConfig | undefined
  stagingSmokeEvidence: StagingSmokeEvidence | undefined
}

setWorldConstructor(AmaWorld)
