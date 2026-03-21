import { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { pipelines, subscribers, jobs, systemLogs } from '../db/schema';
import { webhookQueue } from '../queue';
import { eq, desc } from 'drizzle-orm';
import { logger } from '../utils/logger';

// --- SYSTEM LOGS ---
export const getSystemLogs = async (req: Request, res: Response) => {
    try {
        const logs = await db.select().from(systemLogs).orderBy(desc(systemLogs.createdAt)).limit(100);
        res.status(200).json({ data: logs });
    } catch (error: any) {
        console.error('CRITICAL ERROR FETCHING LOGS:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
};

// --- RETRY JOB ---
export const retryJob = async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params as { jobId: string };
        const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
        if (!job) return res.status(404).json({ error: 'Job not found' });
        
        await db.update(jobs).set({ status: 'pending' }).where(eq(jobs.id, jobId));
        const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, job.pipelineId));
        
        await webhookQueue.add('process-webhook', { jobId: job.id, pipelineId: pipeline.id, action: pipeline.action });
        res.status(200).json({ message: 'Retry queued' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

const PORT = process.env.PORT || 3000;

export const healthCheck = (req: Request, res: Response) => {
    res.status(200).json({ status: 'API is running smoothly' });
};

export const createPipeline = async (req: Request, res: Response) => {
    try {
        const { name, action, subscriberUrls } = req.body;

        if (!name || !action || !subscriberUrls || !Array.isArray(subscriberUrls)) {
            return res.status(400).json({ error: 'Missing required fields or subscriberUrls is not an array' });
        }

        const uniqueSlug = crypto.randomBytes(6).toString('hex'); 
        const sourceUrl = `http://localhost:${PORT}/incoming/${uniqueSlug}`; 

        const createdPipeline = await db.transaction(async (tx) => {
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

            return newPipeline;
        });

        await logger.info(`Pipeline created: ${name}`, { pipelineId: createdPipeline.id, action });

        res.status(201).json({
            message: 'Pipeline created successfully',
            data: createdPipeline
        });

    } catch (error: any) {
        await logger.error('Error creating pipeline', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const ingestWebhook = async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const payload = req.body;
        const fullSourceUrl = `http://localhost:${PORT}/incoming/${slug}`;

        const [pipeline] = await db.select()
            .from(pipelines)
            .where(eq(pipelines.sourceUrl, fullSourceUrl))
            .limit(1);

        if (!pipeline) {
            await logger.warn(`Webhook ingestion failed: Invalid slug ${slug}`);
            return res.status(404).json({ error: 'Webhook URL not found' });
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

        res.status(202).json({ 
            message: 'Webhook received and queued for processing',
            jobId: newJob.id
        });

    } catch (error: any) {
        await logger.error('Error ingesting webhook', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelineJobs = async (req: Request, res: Response) => {
    try {
        const { pipelineId } = req.params as { pipelineId: string };

        const pipelineJobs = await db.select()
            .from(jobs)
            .where(eq(jobs.pipelineId, pipelineId))
            .orderBy(desc(jobs.createdAt));

        res.status(200).json({
            message: 'Job history retrieved successfully',
            count: pipelineJobs.length,
            data: pipelineJobs
        });

    } catch (error: any) {
        await logger.error('Error fetching jobs', { pipelineId: req.params.pipelineId, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelines = async (req: Request, res: Response) => {
    try {
        const allPipelines = await db.select().from(pipelines).orderBy(desc(pipelines.createdAt));
        res.status(200).json({ data: allPipelines });
    } catch (error: any) {
        await logger.error('Error fetching pipelines', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelineById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        
        const [pipeline] = await db.select()
            .from(pipelines)
            .where(eq(pipelines.id, id));

        if (!pipeline) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }

        const pipelineSubscribers = await db.select()
            .from(subscribers)
            .where(eq(subscribers.pipelineId, id));

        res.status(200).json({ 
            data: { ...pipeline, subscribers: pipelineSubscribers } 
        });
    } catch (error: any) {
        await logger.error('Error fetching pipeline by ID', { pipelineId: req.params.id, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updatePipeline = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const { name, action } = req.body;

        const [updatedPipeline] = await db.update(pipelines)
            .set({ name, action })
            .where(eq(pipelines.id, id))
            .returning();

        if (!updatedPipeline) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }

        await logger.info(`Pipeline updated: ${name}`, { pipelineId: id });

        res.status(200).json({ 
            message: 'Pipeline updated', 
            data: updatedPipeline 
        });
    } catch (error: any) {
        await logger.error('Error updating pipeline', { pipelineId: req.params.id, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deletePipeline = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };

        await db.transaction(async (tx) => {
            await tx.delete(jobs).where(eq(jobs.pipelineId, id));
            await tx.delete(subscribers).where(eq(subscribers.pipelineId, id));
            const [deletedPipeline] = await tx.delete(pipelines)
                .where(eq(pipelines.id, id))
                .returning();

            if (!deletedPipeline) {
                throw new Error('Pipeline not found');
            }
        });

        await logger.info(`Pipeline deleted`, { pipelineId: id });

        res.status(200).json({ message: 'Pipeline deleted successfully' });
    } catch (error: any) {
        await logger.error('Error deleting pipeline', { pipelineId: req.params.id, error: error.message });
        if (error.message === 'Pipeline not found') {
            return res.status(404).json({ error: 'Pipeline not found' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};
