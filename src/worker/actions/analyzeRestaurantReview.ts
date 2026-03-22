export const analyzeRestaurantReview = async (payload: any, jobId: string) => {
    const reviewText = payload.review_text || payload.comment || payload.text || "";
    
    if (!reviewText) {
        console.warn(`⚠️ No review text found in payload for job ${jobId}`);
        return payload;
    }

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
        throw new Error(`OpenAI API Error: ${aiData.error.message}`);
    }

    if (aiData.choices && aiData.choices.length > 0) {
        const analysis = JSON.parse(aiData.choices[0].message.content);
        return { 
            ...payload, 
            ai_insights: analysis
        };
    } else {
        throw new Error("AI API returned no choices");
    }
};