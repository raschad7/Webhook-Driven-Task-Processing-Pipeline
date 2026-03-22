import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ 
    path: path.join(process.cwd(), '.env'), 
    override: true 
});

import { Worker, Job } from 'bullmq';
import { db } from '../db';
import { jobs, subscribers } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { actionRegistry } from './actions';

const redisConnection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null
};

console.log('👷 Worker is running and listening for jobs...');
const apiKey = process.env.OPENAI_API_KEY || '';
console.log(`🔑 Using OpenAI Key ending in: ...${apiKey.slice(-4) || 'NOT FOUND'}`);

// Initialize the Worker
const worker = new Worker('webhook-processing', async (job: Job) => {
    const { jobId, pipelineId, action } = job.data;
    await logger.info(`Picked up job for processing`, { jobId, action });
    
    try {
        // 1. Mark job as "processing"
        await db.update(jobs).set({ status: 'processing' }).where(eq(jobs.id, jobId));

        // 2. Fetch the actual payload and the subscribers from the DB
        const [currentJob] = await db.select().from(jobs).where(eq(jobs.id, jobId));
        if (!currentJob) throw new Error(`Job ${jobId} not found in database`);

        const pipelineSubscribers = await db.select().from(subscribers).where(eq(subscribers.pipelineId, pipelineId));

        const payload = JSON.parse(currentJob.payload as string);
        
        // 3. EXECUTE STRATEGY ACTION
        const actionHandler = actionRegistry[action];
        
        if (!actionHandler) {
            throw new Error(`Unsupported action: ${action}`);
        }

        const processedPayload = await actionHandler(payload, jobId);


        // 4. DELIVERY TO SUBSCRIBERS
        for (const sub of pipelineSubscribers) {
            console.log(`🚀 Delivering to: ${sub.url}`);
            const response = await fetch(sub.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(processedPayload)
            });

            if (!response.ok) {
                throw new Error(`Delivery failed to ${sub.url} (${response.status})`);
            }
        }

        // 5. Success
        await db.update(jobs).set({ status: 'completed' }).where(eq(jobs.id, jobId));
        await logger.info(`Job processed and delivered successfully`, { jobId, pipelineId });
        console.log(`✨ Job ${jobId} finished!`);

    } catch (error: any) {
        await logger.error(`Job failed during processing`, { jobId, error: error.message });
        
        if (job.attemptsMade >= (job.opts.attempts || 1) - 1) {
            await db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, jobId));
        }
        throw error;
    }
}, {
    connection: redisConnection,
    concurrency: 5
});

worker.on('error', err => {
    console.error('Worker error:', err);
});