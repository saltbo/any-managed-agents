import { z } from 'zod'
import { EXTERNAL_RUNTIME_NAMES } from './runtime-names'
import type { AmaEvent, AmaSessionEventType } from './session-events'
import { AMA_SESSION_EVENT_DEFINITIONS } from './session-events'

const AmaSessionEventTypeValues = Object.keys(AMA_SESSION_EVENT_DEFINITIONS) as [
  AmaSessionEventType,
  ...AmaSessionEventType[],
]

export const JsonObjectSchema = z.record(z.string(), z.unknown())
export const StringMapSchema = z.record(z.string(), z.string())
export const ExternalRuntimeNameSchema = z.enum(EXTERNAL_RUNTIME_NAMES)
export const AmaSessionEventTypeSchema = z.enum(AmaSessionEventTypeValues)

export const RuntimeBridgeRunMessageSchema = z
  .object({
    type: z.literal('run'),
    requestId: z.string(),
    runtime: ExternalRuntimeNameSchema,
    sessionId: z.string(),
    cwd: z.string(),
    env: StringMapSchema,
    prompt: z.string(),
    provider: z.string().optional(),
    model: z.string().optional(),
    agentSnapshot: JsonObjectSchema.optional(),
    runtimeConfig: JsonObjectSchema.optional(),
    resumeToken: z.string().optional(),
    resume: z.boolean().optional(),
  })
  .strict()

export const RuntimeBridgeControlMessageSchema = z
  .object({
    type: z.enum(['abort', 'send', 'permissionDecision']),
    requestId: z.string(),
    message: z.string().optional(),
    permissionId: z.string().optional(),
    allowed: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict()

export const RuntimeBridgeInventoryMessageSchema = z
  .object({
    type: z.literal('inventory'),
    requestId: z.string(),
    env: StringMapSchema,
    includeUsage: z.boolean().optional(),
  })
  .strict()

export const RuntimeBridgeInputMessageSchema = z.union([
  RuntimeBridgeRunMessageSchema,
  RuntimeBridgeControlMessageSchema,
  RuntimeBridgeInventoryMessageSchema,
])

export const RuntimeUsageWindowSchema = z
  .object({
    label: z.string(),
    utilization: z.number(),
    resetsAt: z.string(),
  })
  .strict()

export const RuntimeInventoryEntrySchema = z
  .object({
    runtime: ExternalRuntimeNameSchema,
    binary: z.string(),
    installed: z.boolean(),
    fallbackModels: z.array(z.string()),
    models: z.array(z.string()),
    status: z.string(),
    version: z.string().optional(),
    detail: z.string(),
    usageWindows: z.array(RuntimeUsageWindowSchema).optional(),
    limitedDetail: z.string().optional(),
  })
  .strict()

export const RuntimeBridgeInventoryResultSchema = z
  .object({
    runtimes: z.array(RuntimeInventoryEntrySchema),
  })
  .strict()

export const AmaRuntimeEventSchema = z
  .object({
    type: AmaSessionEventTypeSchema,
    payload: JsonObjectSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict()

export const RuntimeBridgeErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  })
  .strict()

export const RuntimeBridgeOutputMessageSchema = z
  .object({
    type: z.enum(['ready', 'runtime.event', 'resumeToken', 'result', 'error']),
    requestId: z.string().optional(),
    event: AmaRuntimeEventSchema.optional(),
    result: JsonObjectSchema.optional(),
    error: RuntimeBridgeErrorSchema.optional(),
    resumeToken: z.string().optional(),
  })
  .strict()

export type RuntimeBridgeRunMessage = z.infer<typeof RuntimeBridgeRunMessageSchema>
export type RuntimeBridgeControlMessage = z.infer<typeof RuntimeBridgeControlMessageSchema>
export type RuntimeBridgeInventoryMessage = z.infer<typeof RuntimeBridgeInventoryMessageSchema>
export type RuntimeBridgeInputMessage = z.infer<typeof RuntimeBridgeInputMessageSchema>
export type RuntimeUsageWindow = z.infer<typeof RuntimeUsageWindowSchema>
export type RuntimeInventoryEntry = z.infer<typeof RuntimeInventoryEntrySchema>
export type AmaRuntimeEvent = AmaEvent
export type RuntimeBridgeOutputMessage = z.infer<typeof RuntimeBridgeOutputMessageSchema>
