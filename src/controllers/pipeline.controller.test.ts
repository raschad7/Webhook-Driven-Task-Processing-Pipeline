import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { healthCheck } from './pipeline.controller';

describe('Pipeline Controller', () => {
    describe('healthCheck', () => {
        let mockRequest: Partial<Request>;
        let mockResponse: Partial<Response>;
        let jsonMock: ReturnType<typeof vi.fn>;
        let statusMock: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            jsonMock = vi.fn();
            statusMock = vi.fn().mockReturnValue({ json: jsonMock });
            
            mockRequest = {};
            mockResponse = {
                status: statusMock,
                json: jsonMock
            };
        });

        it('should return 200 and a success message', () => {
            healthCheck(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'API is running smoothly' });
        });
    });
});
