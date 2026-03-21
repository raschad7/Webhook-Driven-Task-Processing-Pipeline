import express, { Request, Response, NextFunction } from 'express';
import * as pipelineController from './controllers/pipeline.controller';
import { webhookLimiter } from './middlewares/rateLimiter'; 
import { requireApiKey } from './middlewares/auth';
import { logger } from './utils/logger';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Request Logging Middleware for Admin APIs
const adminLogger = async (req: Request, res: Response, next: NextFunction) => {
    // We only log non-GET administrative requests to keep logs meaningful
    if (req.path.startsWith('/api') && req.method !== 'GET') {
        await logger.info(`Admin Request: ${req.method} ${req.path}`, { 
            ip: req.ip,
            userAgent: req.get('user-agent')
        });
    }
    next();
};

app.use(adminLogger);

// Health check
app.get('/health', pipelineController.healthCheck);

// Logs and Job management
app.get('/api/logs', requireApiKey, pipelineController.getSystemLogs);
app.post('/api/jobs/:jobId/retry', requireApiKey, pipelineController.retryJob);

// Create a new pipeline
app.post('/api/pipelines', requireApiKey, pipelineController.createPipeline);

// --- QUERY JOB HISTORY ENDPOINT ---
app.get('/api/pipelines/:pipelineId/jobs', requireApiKey, pipelineController.getPipelineJobs);
// --- GET ALL PIPELINES ENDPOINT ---
app.get('/api/pipelines', requireApiKey, pipelineController.getPipelines);

// --- GET SINGLE PIPELINE ENDPOINT ---
app.get('/api/pipelines/:id', requireApiKey, pipelineController.getPipelineById);

// --- UPDATE PIPELINE ENDPOINT ---
app.put('/api/pipelines/:id', requireApiKey, pipelineController.updatePipeline);
// --- DELETE PIPELINE ENDPOINT ---
app.delete('/api/pipelines/:id', requireApiKey, pipelineController.deletePipeline);




//public endpoint
// --- INGESTION ENDPOINT ---
app.post('/incoming/:slug', webhookLimiter, pipelineController.ingestWebhook);


app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
