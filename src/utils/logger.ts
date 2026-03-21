import { db } from '../db';
import { systemLogs } from '../db/schema';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export const logger = {
    info: async (message: string, context?: any) => {
        console.log(`[INFO] ${message}`, context ? JSON.stringify(context) : '');
        await saveToDb('info', message, context);
    },
    
    warn: async (message: string, context?: any) => {
        console.warn(`[WARN] ${message}`, context ? JSON.stringify(context) : '');
        await saveToDb('warn', message, context);
    },

    error: async (message: string, context?: any) => {
        console.error(`[ERROR] ${message}`, context ? JSON.stringify(context) : '');
        await saveToDb('error', message, context);
    },

    debug: async (message: string, context?: any) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[DEBUG] ${message}`, context ? JSON.stringify(context) : '');
        }
        await saveToDb('debug', message, context);
    }
};

async function saveToDb(level: LogLevel, message: string, context?: any) {
    try {
        await db.insert(systemLogs).values({ 
            level, 
            message, 
            context: context ? (typeof context === 'object' ? context : { data: context }) : null 
        });
    } catch (dbError) {
        // Fallback to console so we don't lose the log if the DB is down
        console.error('CRITICAL: Failed to save log to database:', dbError);
    }
}