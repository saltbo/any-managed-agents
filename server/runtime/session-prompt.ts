// Shim: prompt dispatch now lives in usecases/runtime/session-prompt as
// deps-first functions over ports. This wrapper preserves the (env, db, ...)
// signature the gateway adapter relies on, building the prompt deps subset inline
// (the full cloud-turn deps plus the runner channel) and delegating. Deleted once
// the callers thread Deps directly.

import { createRunnerChannel } from '../adapters/gateways/runner-channel'
import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'
import {
  dispatchSessionPrompt as dispatchSessionPromptUsecase,
  type PromptDeps,
  type PromptDispatchOutcome,
} from '../usecases/runtime'
import { cloudTurnDeps } from './cloud-turn'
import type { Db } from './session-base'

export type { PromptDispatchOutcome }

function promptDeps(env: Env, db: Db): PromptDeps {
  return {
    ...cloudTurnDeps(env, createRuntimeOrchestrationRepo(db)),
    runnerChannel: createRunnerChannel(env),
  }
}

export async function dispatchSessionPrompt(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  content: string,
): Promise<PromptDispatchOutcome> {
  return dispatchSessionPromptUsecase(promptDeps(env, db), auth, sessionId, content)
}
