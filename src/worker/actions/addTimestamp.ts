export const addTimestamp = async (payload: any) => {
    return {
        ...payload,
        processed_at: new Date().toISOString()
    };
};