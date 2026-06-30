import type { SessionFormState } from '@/console/types'
import type { MemoryStore, SessionInput } from '@/lib/amarpc'

export function sessionResourcesInput(
  form: SessionFormState,
  memoryStores: Array<Pick<MemoryStore, 'metadata'>>,
): Pick<SessionInput['spec'], 'volumes' | 'volumeMounts'> {
  const volumes: NonNullable<SessionInput['spec']['volumes']> = []
  const volumeMounts: NonNullable<SessionInput['spec']['volumeMounts']> = []
  for (const vaultId of form.credentialVaultIds) {
    const name = safeVolumeName('vault', vaultId)
    volumes.push({ name, type: 'secret', secretRef: `ama://vaults/${encodeURIComponent(vaultId)}` })
    volumeMounts.push({ name, mountPath: `/workspace/.ama/secrets/${vaultId}`, readOnly: true })
  }
  form.resources.forEach((resource, index) => {
    if (resource.type === 'git_repository') {
      const url = resource.url.trim()
      if (!url) return
      const name = safeVolumeName('repo', resource.id)
      volumes.push({
        name,
        type: 'git_repository',
        url,
        ...(resource.ref.trim() ? { ref: resource.ref.trim() } : {}),
      })
      volumeMounts.push({ name, mountPath: gitRepositoryMountPath(url, index), readOnly: true })
      return
    }
    if (!resource.memoryStoreId) return
    const store = memoryStores.find((candidate) => candidate.metadata.uid === resource.memoryStoreId)
    const name = safeVolumeName('memory', resource.memoryStoreId)
    volumes.push({
      name,
      type: 'memory',
      memoryRef: `ama://memories/${encodeURIComponent(resource.memoryStoreId)}`,
      access: resource.access,
      ...(store?.metadata.name ? { storeName: store.metadata.name } : {}),
      ...(store?.metadata.description ? { description: store.metadata.description } : {}),
    })
    volumeMounts.push({
      name,
      mountPath: `/workspace/.ama/memory-stores/${resource.memoryStoreId}`,
      readOnly: resource.access !== 'read_write',
    })
  })
  return { volumes, volumeMounts }
}

function safeVolumeName(prefix: string, value: string) {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  return `${prefix}-${safe || 'resource'}`.slice(0, 80)
}

function gitRepositoryMountPath(url: string, index: number) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `/workspace/repos/repository-${index + 1}`
  }
  const path = parsed.pathname
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean)
    .join('/')
  return `/workspace/repos/${parsed.hostname}/${path || `repository-${index + 1}`}`
}
