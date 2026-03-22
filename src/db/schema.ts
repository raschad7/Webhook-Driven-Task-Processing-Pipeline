import { pgTable, text, timestamp, uuid,jsonb,varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const pipelines = pgTable('pipelines', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  sourceUrl: text('source_url').notNull().unique(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const subscribers = pgTable('subscribers', {
  id: uuid('id').defaultRandom().primaryKey(),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id, { onDelete: 'cascade' }).notNull(),
  payload: text('payload').notNull(), // Storing JSON as text, or you can use jsonb()
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


export const systemLogs = pgTable('system_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    level: varchar('level', { length: 20 }).notNull(), // 'info', 'warn', 'error'
    message: text('message').notNull(),
    context: jsonb('context'), // Flexible JSON storage for extra details
    createdAt: timestamp('created_at').defaultNow().notNull()
});

// This tells Drizzle how the tables relate to each other
export const pipelineRelations = relations(pipelines, ({ many }) => ({
  subscribers: many(subscribers),
  jobs: many(jobs),
}));