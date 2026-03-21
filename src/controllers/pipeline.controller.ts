import { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { pipelines, subscribers, jobs } from '../db/schema';
import { webhookQueue } from '../queue';
import { eq, desc } from 'drizzle-orm';

const PORT = process.env.PORT || 3000;

export const healthCheck = (req: Request, res: Response) => {
    res.status(200).json({ status: 'API is running smoothly' });
};

export const createPipeline = async (req: Request, res: Response) => {
    try {
        const { name, action, subscriberUrls } = req.body;

        // 1. Basic Validation
        if (!name || !action || !subscriberUrls || !Array.isArray(subscriberUrls)) {
            return res.status(400).json({ error: 'Missing required fields or subscriberUrls is not an array' });
        }

        // 2. Generate a unique Webhook URL (Source)
        const uniqueSlug = crypto.randomBytes(6).toString('hex'); 
        // In production, this would be your actual domain
        const sourceUrl = `http://localhost:${PORT}/incoming/${uniqueSlug}`; 

        // 3. Database Transaction (All or nothing)
        const createdPipeline = await db.transaction(async (tx) => {
            
            // Insert the main pipeline record
            const [newPipeline] = await tx.insert(pipelines).values({
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
                await tx.insert(subscribers).values(subValues);
            }

            return newPipeline;
        });

        // 4. Return success to the user
        res.status(201).json({
            message: 'Pipeline created successfully',
            data: createdPipeline
        });

    } catch (error) {
        console.error('Error creating pipeline:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const ingestWebhook = async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const payload = req.body;
        
        // Reconstruct the full URL to find it in the database
        const fullSourceUrl = `http://localhost:${PORT}/incoming/${slug}`;

        // 1. Find the matching pipeline
        const [pipeline] = await db.select()
            .from(pipelines)
            .where(eq(pipelines.sourceUrl, fullSourceUrl))
            .limit(1);

        if (!pipeline) {
            return res.status(404).json({ error: 'Webhook URL not found' });
        }

        // 2. Save the incoming payload to the database as a "Pending" job
        const [newJob] = await db.insert(jobs).values({
            pipelineId: pipeline.id,
            payload: JSON.stringify(payload), // Save the raw JSON
            status: 'pending'
        }).returning();

        // 3. Push the Job ID onto the Redis Queue
        // We don't put the whole payload in Redis, just the ID, to keep Redis fast and lean.
        await webhookQueue.add('process-webhook', { 
            jobId: newJob.id,
            pipelineId: pipeline.id,
            action: pipeline.action
        });

        // 4. Immediately return 202 Accepted. Do NOT wait for processing.
        res.status(202).json({ 
            message: 'Webhook received and queued for processing',
            jobId: newJob.id
        });

    } catch (error) {
        console.error('Error ingesting webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelineJobs = async (req: Request, res: Response) => {
    try {
        const { pipelineId } = req.params as { pipelineId: string };

        // Fetch all jobs for this pipeline, newest first
        const pipelineJobs = await db.select()
            .from(jobs)
            .where(eq(jobs.pipelineId, pipelineId))
            .orderBy(desc(jobs.createdAt));

        res.status(200).json({
            message: 'Job history retrieved successfully',
            count: pipelineJobs.length,
            data: pipelineJobs
        });

    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPipelines = async (req: Request, res: Response) => {
    try {
        const allPipelines = await db.select().from(pipelines).orderBy(desc(pipelines.createdAt));
        res.status(200).json({ data: allPipelines });
    } catch (error) {
        console.error('Error fetching pipelines:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


// --- GET SINGLE PIPELINE ---
export const getPipelineById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        
        const [pipeline] = await db.select()
            .from(pipelines)
            .where(eq(pipelines.id, id));

        if (!pipeline) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }

        // Fetch the attached subscribers
        const pipelineSubscribers = await db.select()
            .from(subscribers)
            .where(eq(subscribers.pipelineId, id));

        res.status(200).json({ 
            data: { ...pipeline, subscribers: pipelineSubscribers } 
        });
    } catch (error) {
        console.error('Error fetching pipeline:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// --- UPDATE PIPELINE ---
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

        res.status(200).json({ 
            message: 'Pipeline updated', 
            data: updatedPipeline 
        });
    } catch (error) {
        console.error('Error updating pipeline:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// --- DELETE PIPELINE ---
export const deletePipeline = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };

        // We use a transaction to ensure everything is deleted correctly
        await db.transaction(async (tx) => {
            // 1. Delete associated jobs
            await tx.delete(jobs).where(eq(jobs.pipelineId, id));
            
            // 2. Delete associated subscribers
            await tx.delete(subscribers).where(eq(subscribers.pipelineId, id));

            // 3. Delete the pipeline itself
            const [deletedPipeline] = await tx.delete(pipelines)
                .where(eq(pipelines.id, id))
                .returning();

            if (!deletedPipeline) {
                throw new Error('Pipeline not found');
            }
        });

        res.status(200).json({ message: 'Pipeline deleted successfully' });
    } catch (error: any) {
        console.error('Error deleting pipeline:', error);
        if (error.message === 'Pipeline not found') {
            return res.status(404).json({ error: 'Pipeline not found' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};