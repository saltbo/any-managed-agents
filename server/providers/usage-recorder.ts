import { and, desc, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type { CanonicalAmaSessionEvent } from '../../shared/session-events'
import { providerConfigs, providerModels, sessions, usageRecords } from '../db/schema'
import { computeModelCostMicros, isProviderErrorCategory, providerFamily } from './adapters'

type Db = ReturnType<typeof drizzle>

export interface UsageRecordingScope {
  organizationId: string
  projectId: string
  sessionId: string
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function numberField(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function sessionAttribution(db: Db, scope: UsageRecordingScope) {
  return (
    (await db
      .select({
        agentId: sessions.agentId,
        agentVersionId: sessions.agentVersionId,
        modelProvider: sessions.modelProvider,
      })
      .from(sessions)
      .where(and(eq(sessions.id, scope.sessionId), eq(sessions.projectId, scope.projectId)))
      .get()) ?? null
  )
}

// Resolves the configured provider row backing a runtime provider name: a
// configured provider id matches directly, otherwise the provider family type
// (e.g. runtime `cloudflare-workers-ai` -> configured `workers-ai` rows).
async function resolveProviderConfig(db: Db, projectId: string, provider: string) {
  const byId = await db
    .select({ id: providerConfigs.id, type: providerConfigs.type })
    .from(providerConfigs)
    .where(and(eq(providerConfigs.projectId, projectId), eq(providerConfigs.id, provider)))
    .get()
  if (byId) {
    return byId
  }
  return (
    (await db
      .select({ id: providerConfigs.id, type: providerConfigs.type })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.projectId, projectId), eq(providerConfigs.type, providerFamily(provider))))
      .orderBy(desc(providerConfigs.updatedAt))
      .get()) ?? null
  )
}

async function modelPricing(db: Db, projectId: string, providerId: string, modelId: string) {
  const row = await db
    .select({ pricing: providerModels.pricing })
    .from(providerModels)
    .where(
      and(
        eq(providerModels.projectId, projectId),
        eq(providerModels.providerId, providerId),
        eq(providerModels.modelId, modelId),
      ),
    )
    .get()
  if (!row?.pricing) {
    return null
  }
  return JSON.parse(row.pricing) as Record<string, unknown>
}

async function recordModelUsage(
  db: Db,
  scope: UsageRecordingScope,
  sessionEventId: string,
  payload: Record<string, unknown>,
) {
  const promptTokens = numberField(payload, 'promptTokens') ?? numberField(payload, 'inputTokens') ?? 0
  const completionTokens = numberField(payload, 'completionTokens') ?? numberField(payload, 'outputTokens') ?? 0
  const totalTokens = numberField(payload, 'totalTokens') ?? promptTokens + completionTokens
  const eventCostMicros = numberField(payload, 'costMicros')
  if (totalTokens <= 0 && eventCostMicros === null) {
    return
  }
  const session = await sessionAttribution(db, scope)
  const provider = stringField(payload, 'provider') ?? session?.modelProvider ?? 'workers-ai'
  const modelId = stringField(payload, 'model') ?? 'unknown'
  const config = await resolveProviderConfig(db, scope.projectId, provider)
  // Configured provider ids carry no family information themselves; the
  // configured type is the authoritative family for attribution.
  const family = providerFamily(config?.type ?? provider)
  const pricing = config ? await modelPricing(db, scope.projectId, config.id, modelId) : null
  const pricedCostMicros = pricing ? computeModelCostMicros(pricing, { promptTokens, completionTokens }) : null
  const costMicros = eventCostMicros ?? pricedCostMicros
  await db.insert(usageRecords).values({
    id: newId('usage'),
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    agentId: session?.agentId ?? null,
    agentVersionId: session?.agentVersionId ?? null,
    sessionId: scope.sessionId,
    sessionEventId,
    correlationId: null,
    providerId: config?.id ?? null,
    providerType: family,
    modelId,
    status: 'success',
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs: 0,
    costMicros: costMicros ?? 0,
    currency: 'USD',
    usageType: 'model',
    metadata: JSON.stringify({
      costSource: eventCostMicros !== null ? 'event' : pricedCostMicros !== null ? 'model_pricing' : 'unpriced',
    }),
    createdAt: new Date().toISOString(),
  })
}

async function recordToolUsage(
  db: Db,
  scope: UsageRecordingScope,
  sessionEventId: string,
  payload: Record<string, unknown>,
) {
  const toolName = stringField(payload, 'toolName')
  if (!toolName) {
    return
  }
  const session = await sessionAttribution(db, scope)
  const toolCallId = stringField(payload, 'toolCallId')
  await db.insert(usageRecords).values({
    id: newId('usage'),
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    agentId: session?.agentId ?? null,
    agentVersionId: session?.agentVersionId ?? null,
    sessionId: scope.sessionId,
    sessionEventId,
    correlationId: toolCallId ? `tool:${toolCallId}` : null,
    providerId: null,
    providerType: 'sandbox',
    modelId: toolName,
    status: payload.isError === true ? 'error' : 'success',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: numberField(payload, 'durationMs') ?? 0,
    costMicros: 0,
    currency: 'USD',
    usageType: 'tool',
    metadata: '{}',
    createdAt: new Date().toISOString(),
  })
}

// Normalized provider errors carry a stable category; persist the latest one
// on the configured provider so operators see provider health without
// digging through session events. Raw provider payloads never reach here.
async function recordProviderError(db: Db, scope: UsageRecordingScope, payload: Record<string, unknown>) {
  if (!isProviderErrorCategory(payload.category)) {
    return
  }
  const session = await sessionAttribution(db, scope)
  const provider = stringField(payload, 'provider') ?? session?.modelProvider
  if (!provider) {
    return
  }
  const config = await resolveProviderConfig(db, scope.projectId, provider)
  if (!config) {
    return
  }
  const retryAfterSeconds = numberField(payload, 'retryAfterSeconds')
  await db
    .update(providerConfigs)
    .set({
      lastError: JSON.stringify({
        type: 'provider_error',
        category: payload.category,
        message: stringField(payload, 'message') ?? 'Provider request failed.',
        retryable: payload.retryable === true,
        ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
        occurredAt: new Date().toISOString(),
      }),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(providerConfigs.id, config.id), eq(providerConfigs.projectId, scope.projectId)))
}

// Canonical-event seam for provider-domain accounting: model usage rows from
// usage.recorded events (cloud runtime turns and runner-ingested events share
// this insert path), tool usage rows from tool executions, and provider
// lastError health from normalized runtime errors.
export async function recordProviderSignalsForSessionEvent(
  db: Db,
  scope: UsageRecordingScope,
  sessionEventId: string,
  canonicalEvent: CanonicalAmaSessionEvent,
) {
  if (canonicalEvent.type === 'usage.recorded') {
    await recordModelUsage(db, scope, sessionEventId, canonicalEvent.payload)
    return
  }
  if (canonicalEvent.type === 'tool_execution_end') {
    await recordToolUsage(db, scope, sessionEventId, canonicalEvent.payload)
    return
  }
  if (canonicalEvent.type === 'runtime.error') {
    await recordProviderError(db, scope, canonicalEvent.payload)
  }
}
