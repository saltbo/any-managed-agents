// Shim: the runtime secret-env resolver now lives in the gateway adapter
// (adapters/gateways/runtime-secret-env), where the vault-crypto + orchestration
// repo collaborators belong. Existing runtime callers keep importing from here.
export {
  type RuntimeCredentialRef,
  type RuntimeSecretEnvEntry,
  resolveRuntimeSecretEnv,
} from '../adapters/gateways/runtime-secret-env'
