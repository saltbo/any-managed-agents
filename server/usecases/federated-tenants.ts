import type { Deps } from './deps'
import {
  type AuthScope,
  type CreateFederatedTenantInput,
  FederatedTenantConflictError,
  type FederatedTenantRecord,
  type UpdateFederatedTenantFields,
} from './ports'

function normalizeIssuer(issuer: string) {
  return issuer.replace(/\/$/, '')
}

export interface CreateFederatedTenantInputDto {
  issuer: string
  externalTenantId: string
  environmentId: string | null
  capabilities: string[]
  metadata: Record<string, unknown>
}

// (issuer, externalTenantId) is globally unique — one external tenant maps to
// exactly one project — so a clash is a conflict.
export async function createFederatedTenant(
  deps: Deps,
  auth: AuthScope,
  input: CreateFederatedTenantInputDto,
): Promise<FederatedTenantRecord> {
  const issuer = normalizeIssuer(input.issuer)
  const existing = await deps.federatedTenants.findByIssuerTenant(issuer, input.externalTenantId)
  if (existing) {
    throw new FederatedTenantConflictError()
  }
  const create: CreateFederatedTenantInput = {
    issuer,
    externalTenantId: input.externalTenantId,
    projectId: auth.project.id,
    environmentId: input.environmentId,
    capabilities: input.capabilities,
    metadata: input.metadata,
  }
  return deps.federatedTenants.insert(create, new Date().toISOString())
}

export async function updateFederatedTenant(
  deps: Deps,
  auth: AuthScope,
  existing: FederatedTenantRecord,
  patch: {
    enabled?: boolean
    capabilities?: string[]
    environmentId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<FederatedTenantRecord> {
  const fields: UpdateFederatedTenantFields = {
    enabled: patch.enabled ?? existing.enabled,
    capabilities: patch.capabilities ?? existing.capabilities,
    environmentId: patch.environmentId !== undefined ? patch.environmentId : existing.environmentId,
    metadata: patch.metadata ?? existing.metadata,
  }
  return deps.federatedTenants.update(auth.project.id, existing.id, fields, new Date().toISOString())
}
