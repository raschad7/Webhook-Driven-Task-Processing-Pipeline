export const uppercaseKeys = async (payload: any) => {
    return Object.keys(payload).reduce((acc, key) => {
        acc[key.toUpperCase()] = payload[key];
        return acc;
    }, {} as Record<string, any>);
};