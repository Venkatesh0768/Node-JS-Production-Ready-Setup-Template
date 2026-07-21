import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import flightController from '../src/controller/flightController';
import { adivahaService } from '../src/service/adivahaService';
import * as bookingService from '../src/service/bookingService';
import responseMessage from '../src/constant/responseMessage';

// --- Mocks ---
vi.mock('../src/service/adivahaService');
vi.mock('../src/service/bookingService', () => ({
    saveBookingToDB: vi.fn(),
}));
vi.mock('../src/util/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('flightController', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        req = { body: {} };
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        next = vi.fn();
        vi.clearAllMocks();
    });

    describe('searchFlights', () => {
        it('should return 200 and data on success', async () => {
            const mockData = { some: 'data' };
            vi.mocked(adivahaService.searchFlights).mockResolvedValue(mockData);

            await flightController.searchFlights(req as Request, res as Response, next);

            expect(adivahaService.searchFlights).toHaveBeenCalledWith(expect.objectContaining({ action: 'flightSearch' }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                message: responseMessage.SUCCESS,
                data: mockData
            }));
        });
    });

    describe('getFareQuote', () => {
        it('should return 200 when fare is available via Results.Fare', async () => {
            req.body = { TraceId: '123' };
            const mockFareQuote = {
                responseData: { Response: { Results: { Fare: { OfferedFare: 1500 } } } }
            };
            vi.mocked(adivahaService.fareQuote).mockResolvedValue(mockFareQuote);

            await flightController.getFareQuote(req as Request, res as Response, next);

            expect(adivahaService.fareQuote).toHaveBeenCalledWith({ TraceId: '123', action: 'fareQuote' });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should return 422 FARE_UNAVAILABLE when offeredFare is 0 and no components are provided', async () => {
            req.body = { TraceId: '123' };
            const mockFareQuote = {
                responseData: { Response: { Results: { Fare: { OfferedFare: 0, PublishedFare: 0 } } } }
            };
            vi.mocked(adivahaService.fareQuote).mockResolvedValue(mockFareQuote);

            await flightController.getFareQuote(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: responseMessage.FARE_UNAVAILABLE,
                status_code: 422
            }));
        });

        it('should compute fare properly when OfferedFare is 0 but BaseFare and Tax exist', async () => {
            req.body = { TraceId: '123' };
            const mockFareQuote = {
                FareBreakdown: [{ BaseFare: 1000, Tax: 500, YQTax: 100 }]
            };
            vi.mocked(adivahaService.fareQuote).mockResolvedValue(mockFareQuote);

            await flightController.getFareQuote(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(200);
            // Fare computed: 1000 + 500 + 100 = 1600 > 0
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });
    });

    describe('ticketLcc', () => {
        it('should save booking to DB and return 200 on valid offered fare', async () => {
            req.body = {
                Passengers: [{ Fare: { OfferedFare: 1200 } }]
            };
            const mockTicketResponse = { BookingId: 12345 };
            vi.mocked(adivahaService.ticketForLcc).mockResolvedValue(mockTicketResponse);

            await flightController.ticketLcc(req as Request, res as Response, next);

            expect(adivahaService.ticketForLcc).toHaveBeenCalledWith({ ...req.body, action: 'ticketForLcc' });
            expect(bookingService.saveBookingToDB).toHaveBeenCalledWith(req.body, mockTicketResponse, true);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: mockTicketResponse }));
        });

        it('should return 422 if offered fare is missing or 0', async () => {
            req.body = { Passengers: [{ Fare: { OfferedFare: 0 } }] };

            await flightController.ticketLcc(req as Request, res as Response, next);

            expect(adivahaService.ticketForLcc).not.toHaveBeenCalled();
            expect(bookingService.saveBookingToDB).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: responseMessage.INVALID_OFFERED_FARE,
                status_code: 422
            }));
        });
    });

    describe('bookFlight', () => {
        it('should save non-LCC booking to DB and return 200', async () => {
            req.body = {
                Passengers: [{ Fare: { OfferedFare: '2000' } }]
            };
            const mockBookResponse = { BookingId: 54321 };
            vi.mocked(adivahaService.flightBook).mockResolvedValue(mockBookResponse);

            await flightController.bookFlight(req as Request, res as Response, next);

            expect(adivahaService.flightBook).toHaveBeenCalledWith({ ...req.body, action: 'flightBook', IsLCC: '0' });
            expect(bookingService.saveBookingToDB).toHaveBeenCalledWith(req.body, mockBookResponse, false);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: mockBookResponse }));
        });
    });
});
