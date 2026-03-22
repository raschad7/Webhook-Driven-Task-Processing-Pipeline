import express, { Request, Response, NextFunction } from 'express';
import * as pipelineController from './controllers/pipeline.controller';
import { webhookLimiter } from './middlewares/rateLimiter'; 
import { requireApiKey } from './middlewares/auth';
import { logger } from './utils/logger';

const app = express();

// Standard Middleware
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Administrative Request Logger
const adminLogger = async (req: Request, res: Response, next: NextFunction) => {
    // Audit log for non-GET administrative actions
    if (req.path.startsWith('/api') && req.method !== 'GET') {
        try {
            await logger.info(`Admin Action: ${req.method} ${req.path}`, { 
                ip: req.ip,
                userAgent: req.get('user-agent')
            });
        } catch (err) {
            console.error('Logging middleware failed:', err);
        }
    }
    next();
};

app.use(adminLogger);

// --- Public Endpoints ---
app.get('/health', pipelineController.healthCheck);
app.post('/incoming/:slug', webhookLimiter, pipelineController.ingestWebhook);

// --- Administrative API Endpoints (Protected by API Key) ---

// Pipeline Management
app.get('/api/pipelines', requireApiKey, pipelineController.getPipelines);
app.post('/api/pipelines', requireApiKey, pipelineController.createPipeline);
app.get('/api/pipelines/:id', requireApiKey, pipelineController.getPipelineById);
app.put('/api/pipelines/:id', requireApiKey, pipelineController.updatePipeline);
app.delete('/api/pipelines/:id', requireApiKey, pipelineController.deletePipeline);

// Job Management
app.get('/api/pipelines/:pipelineId/jobs', requireApiKey, pipelineController.getPipelineJobs);
app.post('/api/jobs/:jobId/retry', requireApiKey, pipelineController.retryJob);

// System Observation
app.get('/api/logs', requireApiKey, pipelineController.getSystemLogs);

// --- Global Error Handler ---
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ error: 'An unexpected error occurred on the server.' });
});

app.listen(PORT, () => {
    console.log(`🚀 PipelineFlow Server is listening on port ${PORT}`);
});
