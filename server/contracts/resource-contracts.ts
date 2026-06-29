import { z } from '@hono/zod-openapi'

export const ResourcePhaseSchema = z.enum(['active', 'archived']).openapi('ResourcePhase')

export const ResourceMetadataSchema = z
  .object({
    uid: z.string().openapi({ example: 'resource_abc123' }),
    pid: z.string().nullable().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Default resource' }),
    description: z.string().nullable().openapi({ example: 'Default project resource.' }),
    labels: z.record(z.string(), z.string()),
    annotations: z.record(z.string(), z.string()),
    createdBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  })
  .openapi('ResourceMetadata')
