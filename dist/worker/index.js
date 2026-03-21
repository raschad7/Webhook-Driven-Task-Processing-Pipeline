"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const redisConnection = {
    host: '127.0.0.1',
    port: 6379,
    maxRetriesPerRequest: null
};
console.log('👷 Worker is running and listening for jobs...'); //remove , wnd use logger to db 
// Initialize the Worker
const worker = new bullmq_1.Worker('webhook-processing', async (job) => {
    const { jobId, pipelineId, action } = job.data;
    console.log(`\n📦 Picked up job ${jobId} (Action: ${action})`);
    try {
        // 1. Mark job as "processing"
        await db_1.db.update(schema_1.jobs).set({ status: 'processing' }).where((0, drizzle_orm_1.eq)(schema_1.jobs.id, jobId));
        // 2. Fetch the actual payload and the subscribers from the DB
        const [currentJob] = await db_1.db.select().from(schema_1.jobs).where((0, drizzle_orm_1.eq)(schema_1.jobs.id, jobId));
        const pipelineSubscribers = await db_1.db.select().from(schema_1.subscribers).where((0, drizzle_orm_1.eq)(schema_1.subscribers.pipelineId, pipelineId));
        let payload = JSON.parse(currentJob.payload);
        let processedPayload = payload;
        // ==========================================
        // 3. THE 3 PROCESSING ACTIONS
        // ==========================================
        if (action === 'mask_pii') {
            // Action 1: Hide sensitive data
            processedPayload = { ...payload };
            if (processedPayload.email)
                processedPayload.email = '***@***.com';
            if (processedPayload.phone)
                processedPayload.phone = '***-****';
        }
        else if (action === 'add_timestamp') {
            // Action 2: Inject a processing timestamp
            processedPayload = { ...payload, processed_at: new Date().toISOString() };
        }
        else if (action === 'uppercase_keys') {
            // Action 3: Convert all top-level JSON keys to uppercase
            processedPayload = Object.keys(payload).reduce((acc, key) => {
                acc[key.toUpperCase()] = payload[key];
                return acc;
            }, {});
        }
        // ==========================================
        // 4. DELIVERY TO SUBSCRIBERS
        // ==========================================
        for (const sub of pipelineSubscribers) {
            console.log(`🚀 Sending data to subscriber: ${sub.url}`);
            // Using native fetch (Node 18+)
            const response = await fetch(sub.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(processedPayload)
            });
            if (!response.ok) {
                // If the subscriber's server is down, throwing an error tells BullMQ to retry later!
                throw new Error(`Delivery failed to ${sub.url} with status: ${response.status}`);
            }
        }
        // 5. If everything succeeded, mark job as completed
        await db_1.db.update(schema_1.jobs).set({ status: 'completed' }).where((0, drizzle_orm_1.eq)(schema_1.jobs.id, jobId));
        console.log(`✅ Job ${jobId} completed successfully!`);
    }
    catch (error) {
        console.error(`❌ Job ${jobId} failed:`, error.message);
        // We do NOT mark it as failed in the DB yet if BullMQ is going to retry it.
        // If it has failed its final attempt, then we update the DB.
        if (job.attemptsMade >= (job.opts.attempts || 1) - 1) {
            await db_1.db.update(schema_1.jobs).set({ status: 'failed' }).where((0, drizzle_orm_1.eq)(schema_1.jobs.id, jobId));
        }
        // Re-throw the error so BullMQ knows this attempt failed and triggers the retry logic
        throw error;
    }
}, { connection: redisConnection });
// Listen for errors on the worker itself
worker.on('error', err => {
    console.error('Worker error:', err);
});
