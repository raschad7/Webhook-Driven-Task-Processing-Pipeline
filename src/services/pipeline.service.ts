import crypto from 'crypto';
import { db } from '../db';
import { pipelines, subscribers, jobs } from '../db/schema';
import { webhookQueue } from '../queue';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

const PORT = process.env.PORT || 3000;
export const PipelineService = {
    async createPipeline(name: string, action: string, subscriberUrls: string[]) {
        const uniqueSlug = crypto.randomBytes(6).toString('hex');
        const sourceUrl = `http://localhost:${PORT}/incoming/${uniqueSlug}`;

        return await db.transaction(async (tx) => {
            const [newPipeline] = await tx.insert(pipelines).values({
                name,
                action,
                sourceUrl
            }).returning();

            if (subscriberUrls.length > 0) {
                const subValues = subscriberUrls.map(url => ({
                    pipelineId: newPipeline.id,
                    url
                }));
                await tx.insert(subscribers).values(subValues);
            }

            await logger.info(`Pipeline created: ${name}`, { pipelineId: newPipeline.id, action });
            return newPipeline;
        });
    },

    async ingestWebhook(slug: string, payload: any) {
        const fullSourceUrl = `http://localhost:${PORT}/incoming/${slug}`;

        const [pipeline] = await db.select()
            .from(pipelines)
            .where(eq(pipelines.sourceUrl, fullSourceUrl))
            .limit(1);

        if (!pipeline) {
            await logger.warn(`Webhook ingestion failed: Invalid slug ${slug}`);
            throw new Error('PIPELINE_NOT_FOUND');
        }

        const [newJob] = await db.insert(jobs).values({
            pipelineId: pipeline.id,
            payload: JSON.stringify(payload),
            status: 'pending'
        }).returning();

        await webhookQueue.add('process-webhook', { 
            jobId: newJob.id,
            pipelineId: pipeline.id,
            action: pipeline.action
        });

        await logger.info(`Webhook ingested and queued`, { pipelineId: pipeline.id, jobId: newJob.id });
        return newJob;
    },

    async getPipelineWithSubscribers(id: string) {
        const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, id));
        if (!pipeline) return null;

        const pipelineSubscribers = await db.select().from(subscribers).where(eq(subscribers.pipelineId, id));
        return { ...pipeline, subscribers: pipelineSubscribers };
    },

    async deletePipeline(id: string) {
        return await db.transaction(async (tx) => {
            await tx.delete(jobs).where(eq(jobs.pipelineId, id));
            await tx.delete(subscribers).where(eq(subscribers.pipelineId, id));
            const [deletedPipeline] = await tx.delete(pipelines).where(eq(pipelines.id, id)).returning();
            
            if (!deletedPipeline) throw new Error('PIPELINE_NOT_FOUND');
            await logger.info(`Pipeline deleted`, { pipelineId: id });
            return true;
        });
    },

    async retryJob(jobId: string) {
        const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
        if (!job) throw new Error('JOB_NOT_FOUND');

        const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, job.pipelineId));
        if (!pipeline) throw new Error('PIPELINE_NOT_FOUND');

        await db.update(jobs).set({ status: 'pending' }).where(eq(jobs.id, jobId));

        await webhookQueue.add('process-webhook', { 
            jobId: job.id,
            pipelineId: pipeline.id,
            action: pipeline.action
        });

        await logger.info(`Job retry triggered manually`, { jobId });
        return true;
    }
};
