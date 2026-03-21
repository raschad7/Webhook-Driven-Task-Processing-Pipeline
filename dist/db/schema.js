"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineRelations = exports.jobs = exports.subscribers = exports.pipelines = void 0;
// src/db/schema.ts
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.pipelines = (0, pg_core_1.pgTable)('pipelines', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    name: (0, pg_core_1.text)('name').notNull(),
    sourceUrl: (0, pg_core_1.text)('source_url').notNull().unique(),
    action: (0, pg_core_1.text)('action').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.subscribers = (0, pg_core_1.pgTable)('subscribers', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    pipelineId: (0, pg_core_1.uuid)('pipeline_id').references(() => exports.pipelines.id, { onDelete: 'cascade' }).notNull(),
    url: (0, pg_core_1.text)('url').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.jobs = (0, pg_core_1.pgTable)('jobs', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    pipelineId: (0, pg_core_1.uuid)('pipeline_id').references(() => exports.pipelines.id, { onDelete: 'cascade' }).notNull(),
    payload: (0, pg_core_1.text)('payload').notNull(), // Storing JSON as text, or you can use jsonb()
    status: (0, pg_core_1.text)('status').default('pending').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
// This tells Drizzle how the tables relate to each other
exports.pipelineRelations = (0, drizzle_orm_1.relations)(exports.pipelines, ({ many }) => ({
    subscribers: many(exports.subscribers),
    jobs: many(exports.jobs),
}));
