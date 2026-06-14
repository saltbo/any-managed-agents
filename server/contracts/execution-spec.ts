import { z } from '@hono/zod-openapi'

// Workspace resource references and the shared execution-spec building blocks
// that Session and Trigger both use (docs/api-v1-design.md §1.7). Kept in one
// place so the two resources can never drift back into divergent shapes.

const JsonObjectSchema = z.record(z.string(), z.unknown())

const GitHubOwnerSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/, 'Use a GitHub owner slug.')
const GitHubRepoSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use a GitHub repository name.')
  .refine((value) => value !== '.' && value !== '..', 'Use a GitHub repository name.')
const GitRefSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/[\s\p{C}]/u.test(value) &&
      !value.includes('..') &&
      !value.includes('@{') &&
      !value.includes('\\') &&
      !value.startsWith('-') &&
      !value.endsWith('/') &&
      !value.endsWith('.lock'),
    'Use a safe branch, tag, or commit ref.',
  )
const MountPathSchema = z.string().min(1).max(200)
const ResourceCredentialRefSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^vault(?:cred|ver)_[A-Za-z0-9]+$/, 'Use a vault credential or credential version id.')

export const GitHubRepositoryResourceRefSchema = z
  .object({
    type: z.literal('github_repository'),
    owner: GitHubOwnerSchema,
    repo: GitHubRepoSchema,
    ref: GitRefSchema.optional(),
    mountPath: MountPathSchema.optional(),
    credentialRef: ResourceCredentialRefSchema.optional(),
  })
  .strict()
  .openapi('GitHubRepositoryResourceRef')

const LegacyResourceRefSchema = JsonObjectSchema.refine((value) => value.type !== 'github_repository', {
  message: 'GitHub repository resources must use the github_repository schema.',
})

export const ResourceRefSchema = z
  .union([GitHubRepositoryResourceRefSchema, LegacyResourceRefSchema])
  .openapi('ResourceRef')

export type ResourceRef = z.infer<typeof ResourceRefSchema>
