import { z } from '@hono/zod-openapi'

// The governance policy documents. Their merge (server/domain/policy.ts) treats
// known keys with list/boolean/number semantics and passes unknown keys through
// as opaque scalars, so each schema documents the known fields and keeps a
// catchall to preserve forward-compatible extensions on read and write.

const policyEffect = z.enum(['allow', 'deny'])
const connectorApprovalMode = z.enum(['none', 'require_approval'])

export const ToolPolicySchema = z
  .object({
    allowedTools: z.array(z.string()).optional(),
    blockedTools: z.array(z.string()).optional(),
    requireApprovalTools: z.array(z.string()).optional(),
    defaultEffect: policyEffect.optional(),
  })
  .catchall(z.unknown())
  .openapi('ToolPolicy')

export const PolicyMcpPolicySchema = z
  .object({
    allowedConnectors: z.array(z.string()).optional(),
    blockedConnectors: z.array(z.string()).optional(),
    requireApprovalConnectors: z.array(z.string()).optional(),
    requireApprovalTools: z.array(z.string()).optional(),
    connectorApprovalModes: z.record(z.string(), connectorApprovalMode).optional(),
    defaultEffect: policyEffect.optional(),
  })
  .catchall(z.unknown())
  .openapi('PolicyMcpPolicy')

export const SandboxPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    status: z.string().optional(),
    network: z.union([z.string(), z.boolean()]).optional(),
    allowedHosts: z.array(z.string()).optional(),
    blockedCommands: z.array(z.string()).optional(),
    allowedCommands: z.array(z.string()).optional(),
  })
  .catchall(z.unknown())
  .openapi('SandboxPolicy')

export type ToolPolicy = z.infer<typeof ToolPolicySchema>
export type PolicyMcpPolicy = z.infer<typeof PolicyMcpPolicySchema>
export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>
