import { setWorldConstructor, World } from '@cucumber/cucumber'
import type { createApp } from '../../server/app'
import type {
  RestishDiscoveryResult,
  RestishJsonOutputResult,
  RestishOpenApiHarness,
  RestishWorkflowResult,
} from './restish-openapi'

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
  selfHostedRunnerOk: boolean
}

export interface StagingSmokeConfig {
  accessToken?: string
  effectiveStorageState?: string
  loginEmail?: string
  loginPassword?: string
  origin: string
  runId: string
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
