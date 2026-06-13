import {
  type EnvironmentConfig,
  type EnvironmentCredentialRef,
  hasSecretMaterial,
  mcpPolicyConnectorIds,
  RUNTIME_CONFIG_FIELDS,
  validateSecretFreeObjects,
} from '@server/domain/environment'
import type { Deps } from './deps'
import { type AuthScope, EnvironmentArchivedError, type EnvironmentRecord, EnvironmentValidationError } from './ports'

// Validates the config against sibling resources (vault credentials, connected
// MCP connectors) and the secret-free-object rules. Throws
// EnvironmentValidationError on the first failure.
async function validateConfig(deps: Deps, auth: AuthScope, config: EnvironmentConfig) {
  const credentialError = await validateCredentialRefs(
    deps,
    auth.organization.id,
    auth.project.id,
    config.credentialRefs,
  )
  if (credentialError) {
    throw new EnvironmentValidationError('Invalid environment configuration', credentialError)
  }
  const mcpError = await validateMcpPolicy(deps, auth.project.id, config.mcpPolicy)
  if (mcpError) {
    throw new EnvironmentValidationError('Invalid environment configuration', mcpError)
  }
  const secretError = validateSecretFreeObjects(config)
  if (secretError) {
    throw new EnvironmentValidationError('Invalid environment configuration', secretError)
  }
  if (hasSecretMaterial(config.variables)) {
    throw new EnvironmentValidationError('Invalid environment configuration', {
      variables: 'Secret material must be stored in a vault.',
    })
  }
}

// Credential references must resolve to a live vault credential visible to the
// caller. A pinned version must belong to that credential and still be usable.
async function validateCredentialRefs(
  deps: Deps,
  organizationId: string,
  projectId: string,
  credentialRefs: EnvironmentCredentialRef[],
) {
  for (const [index, ref] of credentialRefs.entries()) {
    const field = `credentialRefs[${index}]`
    if (!(await deps.environments.credentialActive(organizationId, projectId, ref.credentialId))) {
      return { [field]: 'Credential reference is not an active vault credential.' }
    }
    if (ref.versionId && !(await deps.environments.credentialVersionUsable(ref.credentialId, ref.versionId))) {
      return { [field]: 'Credential version is not usable for this credential.' }
    }
  }
  return null
}

async function validateMcpPolicy(deps: Deps, projectId: string, mcpPolicy: Record<string, unknown>) {
  for (const connectorId of mcpPolicyConnectorIds(mcpPolicy)) {
    if (!(await deps.environments.connectorConnected(projectId, connectorId))) {
      return { mcpPolicy: `MCP connector is not connected for this project: ${connectorId}` }
    }
  }
  return null
}

export async function createEnvironment(
  deps: Deps,
  auth: AuthScope,
  input: { name: string; description: string | null; config: EnvironmentConfig },
): Promise<EnvironmentRecord> {
  await validateConfig(deps, auth, input.config)
  const createdAt = new Date().toISOString()
  const environment = await deps.environments.insert(
    { projectId: auth.project.id, name: input.name, description: input.description, config: input.config },
    createdAt,
  )
  const version = await deps.environments.insertVersion(environment, input.config, createdAt)
  await deps.environments.setCurrentVersion(environment.id, version.id)
  return { ...environment, currentVersionId: version.id, version: version.version }
}

export interface UpdateEnvironmentPatch {
  name?: string
  description?: string | null
  packages?: EnvironmentConfig['packages']
  variables?: EnvironmentConfig['variables']
  credentialRefs?: EnvironmentConfig['credentialRefs']
  hostingMode?: EnvironmentConfig['hostingMode']
  networkPolicy?: EnvironmentConfig['networkPolicy']
  mcpPolicy?: EnvironmentConfig['mcpPolicy']
  packageManagerPolicy?: EnvironmentConfig['packageManagerPolicy']
  resourceLimits?: EnvironmentConfig['resourceLimits']
  runtimeConfig?: EnvironmentConfig['runtimeConfig']
  metadata?: EnvironmentConfig['metadata']
  archived?: boolean
}

export interface UpdateEnvironmentResult {
  environment: EnvironmentRecord
  archived: boolean
  unarchived: boolean
}

// Orchestrates a PATCH: archive lifecycle transitions, field merge, config
// validation, and version snapshot creation. Returns the updated record plus
// which lifecycle transition happened (so the route can audit). Throws
// EnvironmentArchivedError when field updates target an archived environment.
export async function updateEnvironment(
  deps: Deps,
  auth: AuthScope,
  environment: EnvironmentRecord,
  patch: UpdateEnvironmentPatch,
): Promise<UpdateEnvironmentResult> {
  const { archived, name: _n, description: _d, ...configFields } = patch
  const hasFieldUpdates =
    patch.name !== undefined || patch.description !== undefined || Object.keys(configFields).length > 0

  if (environment.archivedAt) {
    if (hasFieldUpdates) {
      throw new EnvironmentArchivedError()
    }
    if (archived === false) {
      const updatedAt = new Date().toISOString()
      await deps.environments.unarchive(auth.project.id, environment.id, updatedAt)
      return { environment: { ...environment, archivedAt: null, updatedAt }, archived: false, unarchived: true }
    }
    // archived: true (idempotent) or empty patch — no change.
    return { environment, archived: false, unarchived: false }
  }

  const next: EnvironmentConfig = {
    packages: configFields.packages ?? environment.packages,
    variables: configFields.variables ?? environment.variables,
    credentialRefs: configFields.credentialRefs ?? environment.credentialRefs,
    hostingMode: configFields.hostingMode ?? environment.hostingMode,
    networkPolicy: configFields.networkPolicy ?? environment.networkPolicy,
    mcpPolicy: configFields.mcpPolicy ?? environment.mcpPolicy,
    packageManagerPolicy: configFields.packageManagerPolicy ?? environment.packageManagerPolicy,
    resourceLimits: configFields.resourceLimits ?? environment.resourceLimits,
    runtimeConfig: configFields.runtimeConfig ?? environment.runtimeConfig,
    metadata: configFields.metadata ?? environment.metadata,
  }
  await validateConfig(deps, auth, next)

  const updatedAt = new Date().toISOString()
  const runtimeChanged = RUNTIME_CONFIG_FIELDS.some((field) => configFields[field] !== undefined)
  // A runtime change snapshots a new immutable version; otherwise the current
  // version (id + number) is retained.
  const version = runtimeChanged ? await deps.environments.insertVersion(environment, next, updatedAt) : null
  const archivedAt = archived === true ? updatedAt : environment.archivedAt
  const name = patch.name ?? environment.name
  const description = patch.description !== undefined ? patch.description : environment.description
  const currentVersionId = version?.id ?? environment.currentVersionId

  await deps.environments.update(
    auth.project.id,
    environment.id,
    { name, description, config: next, archivedAt, currentVersionId },
    updatedAt,
  )

  const updated: EnvironmentRecord = {
    ...environment,
    ...next,
    name,
    description,
    archivedAt,
    currentVersionId,
    version: version?.version ?? environment.version,
    updatedAt,
  }
  return { environment: updated, archived: archived === true, unarchived: false }
}
