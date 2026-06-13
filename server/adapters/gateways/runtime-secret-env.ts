import type { RuntimeSecretEnvGateway } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../../env'
import { resolveRuntimeSecretEnv } from '../../runtime/secret-env'

type Db = ReturnType<typeof drizzle>

// Wraps the runtime secret-env resolver (vault credential ref → raw secret
// value) behind the gateway port. The resolver decrypts stored ciphertext or
// passes through external-vault references; resolved values are used only for
// runtime dispatch and never persisted.
export function createRuntimeSecretEnvGateway(env: Env, db: Db): RuntimeSecretEnvGateway {
  return {
    async resolve(scope, items) {
      return resolveRuntimeSecretEnv(env, db, scope, items)
    },
  }
}
