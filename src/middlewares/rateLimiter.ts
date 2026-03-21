import rateLimit from 'express-rate-limit';

export const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 50, // limit each IP to 50 requests per window
    message: { error: 'Too many webhooks received. Please slow down and try again in a minute.' }
});