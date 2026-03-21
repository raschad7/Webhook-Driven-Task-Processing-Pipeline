import express from 'express';
import * as pipelineController from './controllers/pipeline.controller';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Health check
app.get('/health', pipelineController.healthCheck);

// Create a new pipeline
app.post('/api/pipelines', pipelineController.createPipeline);

// --- INGESTION ENDPOINT ---
app.post('/incoming/:slug', pipelineController.ingestWebhook);

// --- QUERY JOB HISTORY ENDPOINT ---
app.get('/api/pipelines/:pipelineId/jobs', pipelineController.getPipelineJobs);

// --- GET ALL PIPELINES ENDPOINT ---
app.get('/api/pipelines', pipelineController.getPipelines);

// --- GET SINGLE PIPELINE ENDPOINT ---
app.get('/api/pipelines/:id', pipelineController.getPipelineById);

// --- UPDATE PIPELINE ENDPOINT ---
app.patch('/api/pipelines/:id', pipelineController.updatePipeline);

// --- DELETE PIPELINE ENDPOINT ---
app.delete('/api/pipelines/:id', pipelineController.deletePipeline);

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
