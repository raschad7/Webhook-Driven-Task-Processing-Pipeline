export const maskPii = async (payload: any) => {
    const processed = { ...payload };
    if (processed.email) processed.email = '***@***.com';
    if (processed.phone) processed.phone = '***-****';
    return processed;
};