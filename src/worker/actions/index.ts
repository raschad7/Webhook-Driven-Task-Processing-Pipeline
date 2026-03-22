import { maskPii } from './maskPii';
import { addTimestamp } from './addTimestamp';
import { analyzeRestaurantReview } from './analyzeRestaurantReview';
import { invoiceParser } from './invoiceParser';
import { uppercaseKeys } from './uppercaseKeys';

export type ActionHandler = (payload: any, jobId: string) => Promise<any>;

export const actionRegistry: Record<string, ActionHandler> = {
    'mask_pii': maskPii,
    'add_timestamp': addTimestamp,
    'analyze_restaurant_review': analyzeRestaurantReview,
    'invoice_parser': invoiceParser,
    'uppercase_keys': uppercaseKeys
};
