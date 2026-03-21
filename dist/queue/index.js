"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookQueue = void 0;
const bullmq_1 = require("bullmq");
const redisConnection = {
    host: '127.0.0.1',
    port: 6379,
    maxRetriesPerRequest: null
};
exports.webhookQueue = new bullmq_1.Queue('webhook-processing', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
    }
});
