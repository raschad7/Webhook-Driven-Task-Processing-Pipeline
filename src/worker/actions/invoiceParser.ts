export const invoiceParser = async (payload: any, jobId: string) => {
    const invoiceText = payload.raw_invoice_text || payload.email_body || payload.text || "";
    
    if (!invoiceText) {
        console.warn(`⚠️ No invoice text found for job ${jobId}`);
        return payload;
    }

    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not defined");
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
                content: `You are an AI Accounting Assistant specialized in Restaurant systems. 
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
    
    if (aiData.error) {
        throw new Error(`OpenAI API Error: ${aiData.error.message}`);
    }

    if (aiData.choices && aiData.choices.length > 0) {
        const parsedInvoice = JSON.parse(aiData.choices[0].message.content);
        return { 
            ...payload, 
            r365_ap_data: parsedInvoice
        };
    } else {
        throw new Error("Failed to parse invoice: No choices returned");
    }
};