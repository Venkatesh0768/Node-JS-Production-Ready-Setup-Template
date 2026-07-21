import { NextFunction, Request, RequestHandler, Response } from 'express';
import httpError from '../util/httpError';

/**
 * Middleware factory that validates required fields in req.body.
 * Returns HTTP 400 if any required field is absent or empty.
 */
export function validateBody(...fields: string[]): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction): void => {
        for (const field of fields) {
            const value = (req.body as Record<string, unknown>)[field];
            if (value === undefined || value === null || value === '') {
                httpError(next, new Error(`Missing required body field: ${field}`), req, 400);
                return;
            }
        }
        next();
    };
}
