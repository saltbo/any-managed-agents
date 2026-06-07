import { z } from '@hono/zod-openapi'

const ALLOWED_HOST_PATTERN = /^[a-z0-9.-]+$/

export const EnvironmentHostingModeSchema = z.enum(['cloud', 'self_hosted']).openapi('EnvironmentHostingMode')
export const RuntimeSchema = z.enum(['ama', 'claude-code', 'codex', 'copilot']).openapi('Runtime')

export const EnvironmentNetworkPolicySchema = z
  .object({
    mode: z.enum(['offline', 'restricted', 'unrestricted']),
    allowedHosts: z
      .array(
        z
          .string()
          .min(1)
          .max(253)
          .regex(ALLOWED_HOST_PATTERN, 'Allowed hosts must be lowercase hostnames without ports or protocols.'),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.mode === 'restricted' && (!policy.allowedHosts || policy.allowedHosts.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedHosts'],
        message: 'Restricted network policy requires at least one allowed host.',
      })
    }
    if (policy.mode !== 'restricted' && policy.allowedHosts !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedHosts'],
        message: 'Allowed hosts are only valid when network policy is restricted.',
      })
    }
  })
  .openapi('EnvironmentNetworkPolicy')

export type EnvironmentHostingMode = z.infer<typeof EnvironmentHostingModeSchema>
export type RuntimeName = z.infer<typeof RuntimeSchema>
export type EnvironmentNetworkPolicy = z.infer<typeof EnvironmentNetworkPolicySchema>

export function normalizeEnvironmentNetworkPolicy(value: unknown): EnvironmentNetworkPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { mode: 'unrestricted' }
  }
  const policy = value as Record<string, unknown>
  if (policy.mode === 'offline') {
    return { mode: 'offline' }
  }
  const allowedHosts = Array.isArray(policy.allowedHosts)
    ? policy.allowedHosts.filter((host): host is string => typeof host === 'string' && ALLOWED_HOST_PATTERN.test(host))
    : []
  if (policy.mode === 'restricted' && allowedHosts.length > 0) {
    return { mode: 'restricted', allowedHosts }
  }
  return { mode: 'unrestricted' }
}
