import { z } from '@hono/zod-openapi'
import { MEMORY_STORE_ACCESS } from '../domain/memory-store'
import { CredentialRefSchema } from '../openapi'

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

export const GitHubRepositoryResourceRefSchema = z
  .object({
    type: z.literal('github_repository'),
    owner: GitHubOwnerSchema,
    repo: GitHubRepoSchema,
    ref: GitRefSchema.optional(),
    mountPath: MountPathSchema.optional(),
    // Unified vault credential reference (docs/api-v1-design.md §1.4): the same
    // { credentialId, versionId? } object every other resource uses, replacing
    // the bare vaultcred_/vaultver_ string this field used to carry.
    credentialRef: CredentialRefSchema.optional(),
  })
  .strict()
  .openapi('GitHubRepositoryResourceRef')

export const MemoryStoreResourceRefSchema = z
  .object({
    type: z.literal('memory_store'),
    storeId: z.string().min(1).openapi({ example: 'memstore_abc123' }),
    access: z.enum(MEMORY_STORE_ACCESS).openapi({ example: 'read_only' }),
  })
  .strict()
  .openapi('MemoryStoreResourceRef')

const LegacyResourceRefSchema = JsonObjectSchema.refine(
  (value) => value.type !== 'github_repository' && value.type !== 'memory_store',
  {
    message: 'Known resource types must use their strict schema.',
  },
)

export const ResourceRefSchema = z
  .union([GitHubRepositoryResourceRefSchema, LegacyResourceRefSchema, MemoryStoreResourceRefSchema])
  .openapi('ResourceRef')

export type ResourceRef = z.infer<typeof ResourceRefSchema>
