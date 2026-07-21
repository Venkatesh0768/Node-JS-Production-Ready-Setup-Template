import { NextFunction, Request, Response } from 'express';
import httpResponse from '../util/httpResponse';
import httpError from '../util/httpError';
import responseMessage from '../constant/responseMessage';
import { adivahaService, AdivahaError } from '../service/adivahaService';
import { isDomesticRoute } from '../util/isDomesticRoute';
import logger from '../util/logger';
import { saveBookingToDB } from '../service/bookingService';

// ── Helper to map AdivahaError to the correct HTTP status ────────────────────

function handleAdivahaError(err: unknown, next: NextFunction, req: Request): void {
    if (err instanceof AdivahaError) {
        httpError(next, err, req, err.httpStatus);
    } else {
        httpError(next, err, req, 500);
    }
}

// ── Type helpers ──────────────────────────────────────────────────────────────

interface AdivahaResponseWrapper {
    responseData?: { Response?: FareQuoteInner };
    [key: string]: unknown;
}

interface FareBreakdownEntry {
    BaseFare?: number;
    Tax?: number;
    YQTax?: number;
    OtherCharges?: number;
    Discount?: number;
    AdditionalTxnFeeOfrd?: number;
    PublishedFare?: number;
    OfferedFare?: number;
    [key: string]: unknown;
}

interface FareQuoteInner {
    OfferedFare?: number;
    FareBreakdown?: FareBreakdownEntry[];
    Fare?: FareBreakdownEntry;
    IsLCC?: boolean;
    [key: string]: unknown;
}

type FareQuoteData = AdivahaResponseWrapper & FareQuoteInner;

interface PassengerFare {
    OfferedFare?: number;
    [key: string]: unknown;
}

interface Passenger {
    Fare?: PassengerFare;
    [key: string]: unknown;
}

interface CancelBody {
    order_id?: string;
    ChangeRequestData?: {
        RequestType?: number;
        BookingId?: number;
        Sectors?: unknown[];
        TicketId?: unknown[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * Resolves OfferedFare from a FareQuote API response.
 *
 * Adivaha returns the fare in several possible locations depending on the
 * flight type and API version.  This helper mirrors the deepFind + compute
 * logic in the HTML tester so both surfaces stay consistent.
 *
 * Resolution order (first non-zero value wins):
 *   1. root.FareBreakdown[0].OfferedFare        ← most common path
 *   2. root.Fare.OfferedFare                     ← fallback flat structure
 *   3. responseData.Response.FareBreakdown[0]   ← wrapped response variant
 *   4. root.OfferedFare                          ← rarely present at root
 *   5. Computed: (BaseFare + Tax + YQTax + OtherCharges) - Discount + ATF
 *      — used when the API returns 0 for both OfferedFare and PublishedFare
 *      but provides the constituent fare components (mirrors HTML tester logic)
 *
 * Returns 0 when no fare can be resolved, which the caller treats as an error.
 */
function resolveFareQuote(raw: FareQuoteData): number {
    // Path 1: FareBreakdown array at root
    const rootFb = raw.FareBreakdown?.[0];
    if (rootFb?.OfferedFare && rootFb.OfferedFare > 0) return rootFb.OfferedFare;

    // Path 2: flat Fare object at root
    const rootFare = raw.Fare;
    if (rootFare?.OfferedFare && rootFare.OfferedFare > 0) return rootFare.OfferedFare;

    // Path 3: wrapped responseData.Response variant
    const inner = (raw as AdivahaResponseWrapper)?.responseData?.Response;

    // Path 3a: inner.Results.Fare  ← CONFIRMED actual path from debug log
    // FareQuote puts the quoted flight object inside Results; OfferedFare may be
    // absent — fall back to PublishedFare which is always present.
    const resultsObj = inner?.Results as FareQuoteInner | undefined;
    const resultsFare = resultsObj?.Fare;
    if (resultsFare?.OfferedFare && resultsFare.OfferedFare > 0) return resultsFare.OfferedFare;
    if (resultsFare?.PublishedFare && resultsFare.PublishedFare > 0) return resultsFare.PublishedFare;

    // Path 3b: inner.FareBreakdown[0] (present for some airlines)
    const innerFb = inner?.FareBreakdown?.[0];
    if (innerFb?.OfferedFare && innerFb.OfferedFare > 0) return innerFb.OfferedFare;
    if (inner?.OfferedFare && inner.OfferedFare > 0) return inner.OfferedFare;

    // Path 4: OfferedFare at root (rarely used)
    if (raw.OfferedFare && (raw.OfferedFare as number) > 0) return raw.OfferedFare as number;

    // Path 5: compute from fare components — mirrors HTML tester doFareQuote logic.
    // resultsFare added as final fallback so BaseFare+Tax is used when
    // FareBreakdown is absent (as seen in the debug log for this response).
    const fareSrc: FareBreakdownEntry | undefined = rootFb ?? rootFare ?? innerFb ?? resultsFare;
    if (fareSrc) {
        const base = fareSrc.BaseFare ?? 0;
        const tax = fareSrc.Tax ?? 0;
        const yq = fareSrc.YQTax ?? 0;
        const other = fareSrc.OtherCharges ?? 0;
        const disc = fareSrc.Discount ?? 0;
        const atf = fareSrc.AdditionalTxnFeeOfrd ?? 0;

        if (base > 0) {
            const published = fareSrc.PublishedFare && fareSrc.PublishedFare > 0
                ? fareSrc.PublishedFare
                : base + tax + yq + other;
            const offered = published - disc + atf;
            if (offered > 0) return offered;
        }
    }

    return 0;
}

// ── Controllers ───────────────────────────────────────────────────────────────

export default {
    // GET /api/v1/flights/token
    getToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await adivahaService.createToken();
            httpResponse(req, res, 200, responseMessage.TOKEN_GENERATED);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // GET /api/v1/flights/locations?term=...&limit=...
    getLocations: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const term = req.query.term as string;
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
            const data = await adivahaService.flightLocations(term, limit);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/search
    searchFlights: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const body = req.body as Record<string, unknown>;
            const from = (body.From_IATACODE as string) ?? '';
            const to = (body.To_IATACODE as string) ?? '';
            const payload = {
                ...body,
                action: 'flightSearch',
                isDomestic: isDomesticRoute(from, to),
            };
            const data = await adivahaService.searchFlights(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/fare-rule
    getFareRule: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const payload = { ...req.body, action: 'fareRule' };
            const data = await adivahaService.fareRule(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/fare-quote
    getFareQuote: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const payload = { ...req.body, action: 'fareQuote' };
            const raw = (await adivahaService.fareQuote(payload)) as FareQuoteData;

            // ── DEBUG: log full raw shape so we can see exactly what Adivaha returns ──
            logger.info('FareQuote RAW response (top-level keys + fare paths)', {
                meta: {
                    topLevelKeys:   Object.keys(raw as object),
                    rootOfferedFare:          (raw as Record<string,unknown>).OfferedFare,
                    rootFare:                 (raw as Record<string,unknown>).Fare,
                    rootFareBreakdown0:       Array.isArray((raw as Record<string,unknown>).FareBreakdown)
                                                ? ((raw as Record<string,unknown>).FareBreakdown as unknown[])[0]
                                                : 'NOT_ARRAY',
                    rootResults:              (raw as Record<string,unknown>).Results,
                    responseDataKeys:         (raw as Record<string,unknown>).responseData
                                                ? Object.keys((raw as Record<string,unknown>).responseData as object)
                                                : 'NO_responseData',
                    responseDataResponseKeys: ((raw as Record<string,unknown>).responseData as Record<string,unknown>)?.Response
                                                ? Object.keys(((raw as Record<string,unknown>).responseData as Record<string,unknown>).Response as object)
                                                : 'NO_Response',
                },
            });

            const offeredFare = resolveFareQuote(raw);

            logger.info('FareQuote resolveFareQuote result', {
                meta: { resolvedOfferedFare: offeredFare, isLCC: raw.IsLCC },
            });

            if (offeredFare <= 0) {
                httpError(
                    next,
                    new Error(responseMessage.FARE_UNAVAILABLE),
                    req,
                    422,
                );
                return;
            }
            httpResponse(req, res, 200, responseMessage.SUCCESS, raw);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/ssr
    getSSR: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const payload = { ...req.body, action: 'flightSSR' };
            const data = await adivahaService.flightSSR(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/ticket-lcc
    ticketLcc: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const body = req.body as Record<string, unknown>;
            const passengers = body.Passengers as Passenger[] | undefined;
            // OfferedFare may arrive as a string from the client (collection vars are strings)
            const rawFare = passengers?.[0]?.Fare?.OfferedFare;
            const offeredFare = typeof rawFare === 'string' ? parseFloat(rawFare) : (rawFare ?? 0);

            if (!offeredFare || offeredFare <= 0) {
                httpError(
                    next,
                    new Error(responseMessage.INVALID_OFFERED_FARE),
                    req,
                    422,
                );
                return;
            }
            const payload = { ...body, action: 'ticketForLcc' };
            const data = await adivahaService.ticketForLcc(payload);
            
            // Save to database
            await saveBookingToDB(body, data, true);
            
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/book
    bookFlight: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const body = req.body as Record<string, unknown>;
            const passengers = body.Passengers as Passenger[] | undefined;
            // OfferedFare may arrive as a string from the client (collection vars are strings)
            const rawFare = passengers?.[0]?.Fare?.OfferedFare;
            const offeredFare = typeof rawFare === 'string' ? parseFloat(rawFare) : (rawFare ?? 0);

            if (!offeredFare || offeredFare <= 0) {
                httpError(
                    next,
                    new Error(responseMessage.INVALID_OFFERED_FARE),
                    req,
                    422,
                );
                return;
            }
            const payload = { ...body, action: 'flightBook', IsLCC: '0' };
            const data = await adivahaService.flightBook(payload);
            
            // Save to database
            await saveBookingToDB(body, data, false);
            
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/booking-details
    getBookingDetails: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const body = req.body as Record<string, unknown>;
            const hasBookingId = body.BookingId !== undefined && body.BookingId !== '';
            const hasPNR = body.PNR !== undefined && body.PNR !== '';

            if (!hasBookingId && !hasPNR) {
                httpError(
                    next,
                    new Error('At least one of BookingId or PNR is required'),
                    req,
                    400,
                );
                return;
            }
            const payload = { ...body, action: 'getBookingDetails' };
            const data = await adivahaService.getBookingDetails(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/cancellation-charges
    getCancellationCharges: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const payload = { ...req.body, action: 'getCancellationCharges' };
            const data = await adivahaService.getCancellationCharges(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/cancel
    cancelTicket: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const body = req.body as CancelBody;
            const changeRequestData = body.ChangeRequestData;
            const requestType = changeRequestData?.RequestType;

            // Log before any Adivaha call — cancellation is irreversible
            logger.warn(responseMessage.CANCELLATION_WARNING, {
                meta: { order_id: body.order_id, bookingId: changeRequestData?.BookingId, requestType },
            });

            if (requestType === 2) {
                // Partial cancellation: Sectors and TicketId are mandatory
                const sectors = changeRequestData?.Sectors;
                const ticketId = changeRequestData?.TicketId;
                const sectorsValid = Array.isArray(sectors) && sectors.length > 0;
                const ticketIdValid = Array.isArray(ticketId) && ticketId.length > 0;

                if (!sectorsValid || !ticketIdValid) {
                    httpError(
                        next,
                        new Error(responseMessage.PARTIAL_CANCEL_FIELDS_REQUIRED),
                        req,
                        400,
                    );
                    return;
                }
                // Forward complete body for partial cancellation
                const payload = { ...body, action: 'ticketCancel' };
                const data = await adivahaService.ticketCancel(payload);
                httpResponse(req, res, 200, responseMessage.SUCCESS, data);
            } else {
                // Full cancellation (RequestType = 1): strip Sectors and TicketId
                const cleanChangeRequestData = { ...changeRequestData };
                delete cleanChangeRequestData.Sectors;
                delete cleanChangeRequestData.TicketId;
                const payload = {
                    action: 'ticketCancel',
                    order_id: body.order_id,
                    ChangeRequestData: cleanChangeRequestData,
                };
                const data = await adivahaService.ticketCancel(payload);
                httpResponse(req, res, 200, responseMessage.SUCCESS, data);
            }
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/change-status
    getChangeStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const payload = { ...req.body, action: 'checkChangeStatus' };
            const data = await adivahaService.checkChangeStatus(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/calendar-fare
    getCalendarFare: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const payload = { ...req.body, action: 'GetCalendarFare' };
            const data = await adivahaService.getCalendarFare(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },

    // POST /api/v1/flights/calendar-fare-day
    getCalendarFareDay: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const payload = { ...req.body, action: 'UpdateCalendarFareOfDay' };
            const data = await adivahaService.updateCalendarFareOfDay(payload);
            httpResponse(req, res, 200, responseMessage.SUCCESS, data);
        } catch (err) {
            handleAdivahaError(err, next, req);
        }
    },
};
