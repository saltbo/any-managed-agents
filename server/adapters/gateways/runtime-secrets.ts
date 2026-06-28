import type { EnvFromEntry, ResolvedVolumeMount, Volume, VolumeMount } from '@server/domain/runtime/execution-inputs'
import type { RuntimeSecretGateway } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../../env'
import { decryptSecretValue } from '../../vault-crypto'
import { createRuntimeOrchestrationRepo } from '../repos/runtime-orchestration'

type Db = ReturnType<typeof drizzle>

type ResolvedSecretFile = { path: string; content: string }

// Resolves envFrom secret handles into runtime environment values. Both
// dispatch paths use this seam: self-hosted lease materialization and cloud
// session startup. AMA versions decrypt the stored ciphertext.
// Resolved values exist only in the runtime dispatch; they are never written
// to D1, session events, audit records, or logs.
export async function resolveRuntimeEnvFrom(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  items: EnvFromEntry[],
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  const repo = createRuntimeOrchestrationRepo(db)
  for (const entry of items) {
    if (entry.type !== 'secret') {
      throw new Error(`Runtime envFrom ${entry.name} has unsupported type ${entry.type}`)
    }
    const { secretRef } = entry
    const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
    // Deleted versions are physically removed, so a missing row is unresolvable.
    if (!version) {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    if (version.state === 'revoked') {
      throw new Error(`Runtime secret reference ${secretRef} is revoked by vault policy`)
    }
    const metadata = parseMetadata(version.metadata)
    const value = await decryptSecretValue(env, metadata?.encryptedSecretValue)
    if (typeof value !== 'string') {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    resolved[entry.name] = value
  }
  return resolved
}

export async function resolveRuntimeSecretVolumes(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  volumes: Volume[],
  volumeMounts: VolumeMount[],
): Promise<ResolvedVolumeMount[]> {
  const repo = createRuntimeOrchestrationRepo(db)
  const volumeByName = new Map(volumes.map((volume) => [volume.name, volume]))
  const resolved: ResolvedVolumeMount[] = []
  for (const mount of volumeMounts) {
    const volume = volumeByName.get(mount.name)
    if (!volume) {
      throw new Error(`Runtime volume mount ${mount.name} does not reference a declared volume`)
    }
    if (volume.type !== 'secret') {
      continue
    }
    const secretRef = volume.secretRef
    const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
    if (version) {
      if (version.state !== 'active') {
        throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
      }
      const content = await decryptVersion(env, version.metadata, secretRef)
      resolved.push({
        name: mount.name,
        mountPath: mount.mountPath,
        readOnly: mount.readOnly ?? true,
        files: [{ path: 'value', content }],
      })
      continue
    }
    const versions = await repo.vaultVersionsForResolution(scope.organizationId, scope.projectId, secretRef)
    if (!versions) {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    const files: ResolvedSecretFile[] = []
    for (const credentialVersion of versions) {
      if (credentialVersion.state !== 'active') {
        continue
      }
      files.push({
        path: safeFileName(credentialVersion.name),
        content: await decryptVersion(env, credentialVersion.metadata, credentialVersion.secretRef),
      })
    }
    resolved.push({ name: mount.name, mountPath: mount.mountPath, readOnly: mount.readOnly ?? true, files })
  }
  return resolved
}

async function decryptVersion(env: Env, metadata: string, secretRef: string) {
  const parsed = parseMetadata(metadata)
  const value = await decryptSecretValue(env, parsed?.encryptedSecretValue)
  if (typeof value !== 'string') {
    throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
  }
  return value
}

function safeFileName(value: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`Vault credential name cannot be mounted as a file: ${value}`)
  }
  return value
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Wraps runtime secret projections behind the gateway port. Resolved values are
// used only for runtime dispatch and never persisted.
export function createRuntimeSecretGateway(env: Env, db: Db): RuntimeSecretGateway {
  return {
    async resolveEnv(scope, items) {
      return resolveRuntimeEnvFrom(env, db, scope, items)
    },
    async resolveVolumes(scope, volumes, volumeMounts) {
      return resolveRuntimeSecretVolumes(env, db, scope, volumes, volumeMounts)
    },
  }
}
