import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentDefinitions = sqliteTable('agent_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agentDefinitions.id),
  durableObjectName: text('durable_object_name').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
