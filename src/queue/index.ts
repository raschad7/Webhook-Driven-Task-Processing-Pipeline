import { Queue } from 'bullmq';

const redisConnection = {
    host: '127.0.0.1',
    port: 6379,
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