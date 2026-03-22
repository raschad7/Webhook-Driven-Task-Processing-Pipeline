import { Request, Response } from 'express';
import { db } from '../db';
import { pipelines, jobs, systemLogs } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { PipelineService } from '../services/pipeline.service';

// Define types for internal logic
interface IdParam { id: string; }
interface SlugParam { slug: string; }
interface PipelineIdParam { pipelineId: string; }
interface JobIdParam { jobId: string; }

export const healthCheck = (req: Request, res: Response) => {
    res.status(200).json({ status: 'API is running smoothly' });
};

export const createPipeline = async (req: Request, res: Response) => {
    try {
        const { name, action, subscriberUrls } = req.body;
        if (!name || !action || !subscriberUrls || !Array.isArray(subscriberUrls)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const data = await PipelineService.createPipeline(name, action, subscriberUrls);
        res.status(201).json({ message: 'Pipeline created successfully', data });
    } catch (error: any) {
        await logger.error('Error creating pipeline', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const ingestWebhook = async (req: Request<any>, res: Response) => {
    try {
        const { slug } = req.params as unknown as SlugParam;
        const job = await PipelineService.ingestWebhook(slug, req.body);
        res.status(202).json({ message: 'Webhook received', jobId: job.id });
    } catch (error: any) {
        if (error.message === 'PIPELINE_NOT_FOUND') return res.status(404).json({ error: 'Not found' });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelineJobs = async (req: Request<any>, res: Response) => {
    try {
        const { pipelineId } = req.params as unknown as PipelineIdParam;
        const data = await db.select().from(jobs).where(eq(jobs.pipelineId, pipelineId)).orderBy(desc(jobs.createdAt));
        res.status(200).json({ data });
    } catch (_error: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelines = async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(pipelines).orderBy(desc(pipelines.createdAt));
        res.status(200).json({ data });
    } catch (_error: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelineById = async (req: Request<any>, res: Response) => {
    try {
        const { id } = req.params as unknown as IdParam;
        const data = await PipelineService.getPipelineWithSubscribers(id);
        if (!data) return res.status(404).json({ error: 'Not found' });
        res.status(200).json({ data });
    } catch (_error: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updatePipeline = async (req: Request<any>, res: Response) => {
    try {
        const { id } = req.params as unknown as IdParam;
        const { name, action } = req.body;
        const [updated] = await db.update(pipelines).set({ name, action }).where(eq(pipelines.id, id)).returning();
        if (!updated) return res.status(404).json({ error: 'Not found' });
        res.status(200).json({ data: updated });
    } catch (_error: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deletePipeline = async (req: Request<any>, res: Response) => {
    try {
        const { id } = req.params as unknown as IdParam;
        await PipelineService.deletePipeline(id);
        res.status(200).json({ message: 'Deleted successfully' });
    } catch (error: any) {
        if (error.message === 'PIPELINE_NOT_FOUND') return res.status(404).json({ error: 'Not found' });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getSystemLogs = async (req: Request, res: Response) => {
    try {
        const data = await db.select().from(systemLogs).orderBy(desc(systemLogs.createdAt)).limit(100);
        res.status(200).json({ data });
    } catch (_error: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const retryJob = async (req: Request<any>, res: Response) => {
    try {
        const { jobId } = req.params as unknown as JobIdParam;
        await PipelineService.retryJob(jobId);
        res.status(200).json({ message: 'Retry queued' });
    } catch (error: any) {
        if (error.message === 'JOB_NOT_FOUND') return res.status(404).json({ error: 'Not found' });
        if (error.message === 'PIPELINE_NOT_FOUND') return res.status(404).json({ error: 'Pipeline associated with job not found' });
        res.status(500).json({ error: 'Internal server error' });
    }
};
