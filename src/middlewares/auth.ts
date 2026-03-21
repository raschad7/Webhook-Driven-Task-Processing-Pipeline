// src/middlewares/auth.ts
import { Request, Response, NextFunction } from 'express';

export const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.ADMIN_API_KEY;

    // If no API key is set in the environment, we reject to be safe
    if (!validApiKey) {
        console.error("CRITICAL: ADMIN_API_KEY is not set in the .env file!");
        return res.status(500).json({ error: 'Server authentication not configured.' });
    }

    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
    }

    // If the key matches, let them through!
    next();
};