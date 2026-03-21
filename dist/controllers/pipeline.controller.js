"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPipelines = exports.getPipelineJobs = exports.ingestWebhook = exports.createPipeline = exports.healthCheck = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const queue_1 = require("../queue");
const drizzle_orm_1 = require("drizzle-orm");
const PORT = process.env.PORT || 3000;
const healthCheck = (req, res) => {
    res.status(200).json({ status: 'API is running smoothly' });
};
exports.healthCheck = healthCheck;
const createPipeline = async (req, res) => {
    try {
        const { name, action, subscriberUrls } = req.body;
        // 1. Basic Validation
        if (!name || !action || !subscriberUrls || !Array.isArray(subscriberUrls)) {
            return res.status(400).json({ error: 'Missing required fields or subscriberUrls is not an array' });
        }
        // 2. Generate a unique Webhook URL (Source)
        const uniqueSlug = crypto_1.default.randomBytes(6).toString('hex');
        // In production, this would be your actual domain
        const sourceUrl = `http://localhost:${PORT}/incoming/${uniqueSlug}`;
        // 3. Database Transaction (All or nothing)
        const createdPipeline = await db_1.db.transaction(async (tx) => {
            // Insert the main pipeline record
            const [newPipeline] = await tx.insert(schema_1.pipelines).values({
                name,
                action,
                sourceUrl
            }).returning();
            // Insert the associated subscriber URLs
            if (subscriberUrls.length > 0) {
                const subValues = subscriberUrls.map(url => ({
                    pipelineId: newPipeline.id,
                    url
                }));
                await tx.insert(schema_1.subscribers).values(subValues);
            }
            return newPipeline;
        });
        // 4. Return success to the user
        res.status(201).json({
            message: 'Pipeline created successfully',
            data: createdPipeline
        });
    }
    catch (error) {
        console.error('Error creating pipeline:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.createPipeline = createPipeline;
const ingestWebhook = async (req, res) => {
    try {
        const { slug } = req.params;
        const payload = req.body;
        // Reconstruct the full URL to find it in the database
        const fullSourceUrl = `http://localhost:${PORT}/incoming/${slug}`;
        // 1. Find the matching pipeline
        const [pipeline] = await db_1.db.select()
            .from(schema_1.pipelines)
            .where((0, drizzle_orm_1.eq)(schema_1.pipelines.sourceUrl, fullSourceUrl))
            .limit(1);
        if (!pipeline) {
            return res.status(404).json({ error: 'Webhook URL not found' });
        }
        // 2. Save the incoming payload to the database as a "Pending" job
        const [newJob] = await db_1.db.insert(schema_1.jobs).values({
            pipelineId: pipeline.id,
            payload: JSON.stringify(payload), // Save the raw JSON
            status: 'pending'
        }).returning();
        // 3. Push the Job ID onto the Redis Queue
        // We don't put the whole payload in Redis, just the ID, to keep Redis fast and lean.
        await queue_1.webhookQueue.add('process-webhook', {
            jobId: newJob.id,
            pipelineId: pipeline.id,
            action: pipeline.action
        });
        // 4. Immediately return 202 Accepted. Do NOT wait for processing.
        res.status(202).json({
            message: 'Webhook received and queued for processing',
            jobId: newJob.id
        });
    }
    catch (error) {
        console.error('Error ingesting webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.ingestWebhook = ingestWebhook;
const getPipelineJobs = async (req, res) => {
    try {
        const { pipelineId } = req.params;
        // Fetch all jobs for this pipeline, newest first
        const pipelineJobs = await db_1.db.select()
            .from(schema_1.jobs)
            .where((0, drizzle_orm_1.eq)(schema_1.jobs.pipelineId, pipelineId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.jobs.createdAt));
        res.status(200).json({
            message: 'Job history retrieved successfully',
            count: pipelineJobs.length,
            data: pipelineJobs
        });
    }
    catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getPipelineJobs = getPipelineJobs;
const getPipelines = async (req, res) => {
    try {
        const allPipelines = await db_1.db.select().from(schema_1.pipelines).orderBy((0, drizzle_orm_1.desc)(schema_1.pipelines.createdAt));
        res.status(200).json({ data: allPipelines });
    }
    catch (error) {
        console.error('Error fetching pipelines:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getPipelines = getPipelines;
