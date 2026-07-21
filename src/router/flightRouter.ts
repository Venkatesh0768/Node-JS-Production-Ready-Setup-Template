import { Router } from 'express';
import flightController from '../controller/flightController';
import { validateBody } from '../middleware/validateBody';
import { validateQuery } from '../middleware/validateQuery';

const router = Router();

// ── Utility ───────────────────────────────────────────────────────────────────

// GET /api/v1/flights/token — trigger daily token generation
router.get('/token', flightController.getToken);

// GET /api/v1/flights/locations?term=delhi&limit=5
router.get('/locations', validateQuery('term'), flightController.getLocations);

// ── Booking Flow ──────────────────────────────────────────────────────────────

// POST /api/v1/flights/search
router.post(
    '/search',
    validateBody(
        'From_IATACODE',
        'To_IATACODE',
        'departure_date',
        'adults',
        'children',
        'infants',
        'isoneway',
        'Flights_category',
    ),
    flightController.searchFlights,
);

// POST /api/v1/flights/fare-rule
router.post('/fare-rule', validateBody('TraceId', 'ResultIndex'), flightController.getFareRule);

// POST /api/v1/flights/fare-quote
router.post('/fare-quote', validateBody('TraceId', 'ResultIndex'), flightController.getFareQuote);

// POST /api/v1/flights/ssr  (optional ancillaries)
router.post('/ssr', validateBody('TraceId', 'ResultIndex'), flightController.getSSR);

// POST /api/v1/flights/ticket-lcc  (IsLCC = true)
router.post(
    '/ticket-lcc',
    validateBody('TraceId', 'ResultIndex', 'Passengers'),
    flightController.ticketLcc,
);

// POST /api/v1/flights/book  (IsLCC = false)
router.post(
    '/book',
    validateBody('TraceId', 'ResultIndex', 'Passengers'),
    flightController.bookFlight,
);

// ── Post-Booking ──────────────────────────────────────────────────────────────

// POST /api/v1/flights/booking-details  (custom guard: BookingId OR PNR)
router.post('/booking-details', flightController.getBookingDetails);

// POST /api/v1/flights/cancellation-charges
router.post(
    '/cancellation-charges',
    validateBody('BookingId'),
    flightController.getCancellationCharges,
);

// POST /api/v1/flights/cancel  ⚠ IRREVERSIBLE
router.post(
    '/cancel',
    validateBody('order_id', 'ChangeRequestData'),
    flightController.cancelTicket,
);

// POST /api/v1/flights/change-status
router.post('/change-status', validateBody('ChangeRequestId'), flightController.getChangeStatus);

// ── Fare Tools ────────────────────────────────────────────────────────────────

// POST /api/v1/flights/calendar-fare
router.post(
    '/calendar-fare',
    validateBody('From_IATACODE', 'To_IATACODE', 'departure_date', 'Flights_category'),
    flightController.getCalendarFare,
);

// POST /api/v1/flights/calendar-fare-day
router.post(
    '/calendar-fare-day',
    validateBody('From_IATACODE', 'To_IATACODE', 'departure_date', 'Flights_category'),
    flightController.getCalendarFareDay,
);

export default router;
