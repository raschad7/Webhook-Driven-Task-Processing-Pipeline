import express from 'express';
import crypto from 'crypto'; // Built-in Node module for generating unique IDs
import { db } from './db';
import { pipelines, subscribers, jobs } from './db/schema';

import { webhookQueue } from './queue';
import { eq } from 'drizzle-orm';

const app = express();
app.use(express.json()); // This allows your app to read JSON payloads

const PORT = process.env.PORT || 3000;

// endpoints 

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'API is running smoothly' });
});


// Create a new pipeline with subscribers and generate a unique Webhook URL for the source  
app.post('/api/pipelines', async (req, res) => {
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
});



// --- INGESTION ENDPOINT ---
// We use a wildcard :slug to capture the unique part of the URL
app.post('/incoming/:slug', async (req, res) => {
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
});


app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
