import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ 
    path: path.join(process.cwd(), '.env'), 
    override: true 
});

import { Worker, Job } from 'bullmq';
import { db } from '../db';
import { jobs, subscribers } from '../db/schema';
import { eq } from 'drizzle-orm';

const redisConnection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null
};

console.log('👷 Worker is running and listening for jobs...');
const apiKey = process.env.OPENAI_API_KEY || '';
console.log(`🔑 Using OpenAI Key ending in: ...${apiKey.slice(-4) || 'NOT FOUND'}`);

// Initialize the Worker
const worker = new Worker('webhook-processing', async (job: Job) => {
    const { jobId, pipelineId, action } = job.data;
    console.log(`\n📦 Picked up job ${jobId} (Action: ${action})`);

    try {
        // 1. Mark job as "processing"
        await db.update(jobs).set({ status: 'processing' }).where(eq(jobs.id, jobId));

        // 2. Fetch the actual payload and the subscribers from the DB
        const [currentJob] = await db.select().from(jobs).where(eq(jobs.id, jobId));
        if (!currentJob) throw new Error(`Job ${jobId} not found in database`);

        const pipelineSubscribers = await db.select().from(subscribers).where(eq(subscribers.pipelineId, pipelineId));

        let payload = JSON.parse(currentJob.payload as string);
        let processedPayload = { ...payload };

        // ==========================================
        // 3. THE PROCESSING ACTIONS
        // ==========================================
        if (action === 'mask_pii') {
            if (processedPayload.email) processedPayload.email = '***@***.com';
            if (processedPayload.phone) processedPayload.phone = '***-****';
            
        } else if (action === 'add_timestamp') {
            processedPayload.processed_at = new Date().toISOString();
            
        } else if (action === 'analyze_restaurant_review') {
            const reviewText = payload.review_text || payload.comment || payload.text || "";
            
            if (!reviewText) {
                console.warn(`⚠️ No review text found in payload for job ${jobId}`);
            } else {
                console.log(`🤖 Analyzing restaurant review with GPT-4o-mini...`);
                
                if (!process.env.OPENAI_API_KEY) {
                    throw new Error("OPENAI_API_KEY is not defined in environment variables");
                }

                const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: "gpt-4o-mini", 
                        response_format: { type: "json_object" },
                        messages: [{ 
                            role: "system", 
                            content: `You are an expert Restaurant Operations & Reputation Manager. 
                            Analyze the provided customer review and return a detailed JSON analysis.
                            
                            JSON Schema requirements:
                            {
                                "sentiment": "Positive" | "Neutral" | "Negative",
                                "urgency_score": number (1-10),
                                "primary_issue": string | null,
                                "tags": string[] (max 4),
                                "suggested_response": string (Professional, empathetic response),
                                "detected_language": string,
                                "requires_manager_callback": boolean
                            }
                            
                            Urgency Guidelines: 
                            10: Food poisoning, legal threats, or severe injury.
                            8-9: Extremely angry, multiple issues, or viral potential.
                            1-3: Minor feedback or general praise.`
                        }, {
                            role: "user",
                            content: reviewText
                        }]
                    })
                });
                
                const aiData = await aiResponse.json() as any;
                
                if (aiData.error) {
                    console.error("OpenAI API Error:", aiData.error);
                    throw new Error(`OpenAI API Error: ${aiData.error.message}`);
                }

                if (aiData.choices && aiData.choices.length > 0) {
                    const analysis = JSON.parse(aiData.choices[0].message.content);
                    processedPayload.ai_insights = analysis;
                    console.log(`✅ AI Analysis complete for job ${jobId}`);
                } else {
                    throw new Error("AI API returned no choices");
                }
            }
        } else if (action === 'invoice_parser') {
            const invoiceText = payload.raw_invoice_text || payload.email_body || payload.text || "";
            
            if (!invoiceText) {
                console.warn(`⚠️ No invoice text found for job ${jobId}`);
            } else {
                console.log(`🧾 Parsing supplier invoice with GPT-4o-mini...`);
                
                const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: "gpt-4o-mini", 
                        response_format: { type: "json_object" }, 
                        messages: [{ 
                            role: "system", 
                            content: `You are an AI Accounting Assistant specialized in Restaurant365. 
                            Parse the raw invoice text into a structured JSON format.
                            
                            Output Schema:
                            {
                                "vendor_name": string,
                                "invoice_number": string | null,
                                "invoice_date": string (ISO format if possible),
                                "total_amount": number,
                                "tax_amount": number | null,
                                "line_items": [
                                    {
                                        "item_name": string,
                                        "quantity": number,
                                        "unit_price": number,
                                        "total_price": number,
                                        "gl_category": "Produce" | "Meat" | "Dairy" | "Alcohol" | "Dry Goods" | "Supplies"
                                    }
                                ]
                            }`
                        }, {
                            role: "user",
                            content: invoiceText
                        }]
                    })
                });
                
                const aiData = await aiResponse.json() as any;
                
                if (aiData.choices && aiData.choices.length > 0) {
                    const parsedInvoice = JSON.parse(aiData.choices[0].message.content);
                    processedPayload.r365_ap_data = parsedInvoice;
                    console.log(`✅ Invoice parsed successfully for job ${jobId}`);
                } else {
                    console.error("AI API Error:", aiData);
                    throw new Error("Failed to parse invoice");
                }
            }
        } else if (action === 'uppercase_keys') {
            processedPayload = Object.keys(payload).reduce((acc, key) => {
                acc[key.toUpperCase()] = payload[key];
                return acc;
            }, {} as Record<string, any>);
        }

        // ==========================================
        // 4. DELIVERY TO SUBSCRIBERS
        // ==========================================
        for (const sub of pipelineSubscribers) {
            console.log(`🚀 Delivering to: ${sub.url}`);
            const response = await fetch(sub.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(processedPayload)
            });

            if (!response.ok) {
                throw new Error(`Delivery failed to ${sub.url} (${response.status})`);
            }
        }

        // 5. Success
        await db.update(jobs).set({ status: 'completed' }).where(eq(jobs.id, jobId));
        console.log(`✨ Job ${jobId} finished!`);

    } catch (error: any) {
        console.error(`❌ Job ${jobId} failed:`, error.message);
        
        if (job.attemptsMade >= (job.opts.attempts || 1) - 1) {
             await db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, jobId));
        }
        throw error;
    }
},{ connection: redisConnection });

worker.on('error', err => {
    console.error('Worker error:', err);
});