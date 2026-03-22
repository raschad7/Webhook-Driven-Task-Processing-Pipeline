import { Queue } from 'bullmq';

const redisConnection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null
};

export const webhookQueue = new Queue('webhook-processing', { 
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3, 
        backoff: {
            type: 'exponential',
            delay: 1000, 
        },
    }
});