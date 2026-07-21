
// Run: node script/generatePostman.js
// Outputs: postman_collection.json at project root

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePost(name, urlPath, rawBody, testScript) {
    return {
        name,
        event: [{ listen: 'test', script: { type: 'text/javascript', exec: testScript } }],
        request: {
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: { mode: 'raw', options: { raw: { language: 'json' } }, raw: rawBody },
            url: {
                raw: `{{base_url}}${urlPath}`,
                host: ['{{base_url}}'],
                path: urlPath.replace(/^\//, '').split('/'),
            },
        },
    };
}

function makeGet(name, urlPath, queryParams, testScript) {
    const qs = queryParams.map((q) => `${q.key}=${q.value}`).join('&');
    return {
        name,
        event: [{ listen: 'test', script: { type: 'text/javascript', exec: testScript } }],
        request: {
            method: 'GET',
            header: [],
            url: {
                raw: `{{base_url}}${urlPath}${qs ? '?' + qs : ''}`,
                host: ['{{base_url}}'],
                path: urlPath.replace(/^\//, '').split('/'),
                query: queryParams,
            },
        },
    };
}

// ─── shared passenger body (uses collection variables) ─────────────────────────

const passengerBody = (isLCC) =>
    JSON.stringify(
        {
            TraceId: '{{traceId}}',
            ResultIndex: '{{resultIndex}}',
            IsLCC: isLCC ? '1' : '0',
            isoneway: 'Yes',
            isDomestic: 'Yes',
            IsDomesticReturn: 'No',
            Passengers: [
                {
                    Title: 'Mr',
                    FirstName: 'Test',
                    LastName: 'Adivaha',
                    PaxType: '1',
                    DateOfBirth: '1995-07-17T00:00:00',
                    Gender: 1,
                    PassportNo: '',
                    PassportExpiry: '',
                    AddressLine1: 'D-88, Delhi',
                    AddressLine2: '',
                    City: 'Delhi',
                    CountryCode: 'IN',
                    CountryName: 'India',
                    Nationality: 'IN',
                    ContactNo: '9999999999',
                    CellCountryCode: '+91',
                    Email: 'test@adivaha.com',
                    IsLeadPax: true,
                    Fare: {
                        Currency: 'INR',
                        BaseFare: '{{baseFare}}',
                        Tax: '{{tax}}',
                        YQTax: '{{yqTax}}',
                        PublishedFare: '{{publishedFare}}',
                        OfferedFare: '{{offeredFare}}',
                        OtherCharges: 0,
                        Discount: 0,
                        TdsOnCommission: 0,
                        TdsOnPLB: 0,
                        TdsOnIncentive: 0,
                        AdditionalTxnFeePub: 0,
                        AdditionalTxnFeeOfrd: 0,
                        ServiceFee: 0,
                    },
                    GSTCompanyAddress: null,
                    GSTCompanyContactNumber: null,
                    GSTCompanyName: null,
                    GSTNumber: null,
                    GSTCompanyEmail: null,
                    Baggage: [],
                    MealDynamic: [],
                    SeatDynamic: [],
                },
            ],
        },
        null,
        2,
    );

// ─── test scripts ──────────────────────────────────────────────────────────────

const assertOk = (label) => [
    `const j = pm.response.json();`,
    `pm.test('${label} — status 200', () => pm.expect(j.status_code).to.eql(200));`,
    `pm.test('${label} — success true', () => pm.expect(j.success).to.be.true);`,
    `console.log('[${label}] data keys:', Object.keys(j.data || {}).join(', '));`,
];

const searchScript = [
    `const j = pm.response.json();`,
    `pm.test('Search 200', () => pm.expect(j.status_code).to.eql(200));`,
    `pm.test('success true', () => pm.expect(j.success).to.be.true);`,
    `// Adivaha wraps response: j.data.responseData.Response contains TraceId + Results`,
    `const raw = j.data;`,
    `const d = (raw && raw.responseData && raw.responseData.Response) ? raw.responseData.Response : raw;`,
    `if (!d || !d.TraceId) { console.error('❌ No TraceId in response — check responseData.Response path'); return; }`,
    `pm.collectionVariables.set('traceId', d.TraceId);`,
    `console.log('✅ traceId saved:', d.TraceId);`,
    ``,
    `// Adivaha Results is array-of-arrays: [[flight, flight], [flight]]`,
    `const flights = [];`,
    `(d.Results || []).forEach(s => { (Array.isArray(s) ? s : [s]).forEach(f => { if (f && f.ResultIndex) flights.push(f); }); });`,
    `if (!flights.length) { console.error('❌ No flights in Results'); return; }`,
    ``,
    `const f = flights[0];`,
    `pm.collectionVariables.set('resultIndex', f.ResultIndex);`,
    `pm.collectionVariables.set('isLCC', String(f.IsLCC));`,
    ``,
    `// save origin / destination from first segment`,
    `const seg = f.Segments && f.Segments[0] && Array.isArray(f.Segments[0]) ? f.Segments[0][0] : (f.Segments && f.Segments[0] ? f.Segments[0] : {});`,
    `const origin = (seg.Origin && seg.Origin.Airport) ? seg.Origin.Airport.AirportCode : '';`,
    `const dest   = (seg.Destination && seg.Destination.Airport) ? seg.Destination.Airport.AirportCode : '';`,
    `if (origin) pm.collectionVariables.set('originIata', origin);`,
    `if (dest)   pm.collectionVariables.set('destIata', dest);`,
    ``,
    `console.log('✅ ResultIndex:', f.ResultIndex, '| IsLCC:', f.IsLCC, '| Fare: ₹' + (f.Fare ? f.Fare.OfferedFare : '?'));`,
    `console.log('📍 Route:', origin, '→', dest, '| Total flights:', flights.length);`,
    `pm.test('TraceId exists', () => pm.expect(d.TraceId).to.be.a('string').and.not.empty);`,
    `pm.test('Results not empty', () => pm.expect(flights.length).to.be.above(0));`,
];

const fareQuoteScript = [
    `const j = pm.response.json();`,
    `pm.test('FareQuote 200', () => pm.expect(j.status_code).to.eql(200));`,
    `pm.test('success true', () => pm.expect(j.success).to.be.true);`,
    ``,
    `// FareQuote: responseData.Response.Results holds the quoted flight object`,
    `// OfferedFare is in Results.Fare.OfferedFare (NOT FareBreakdown — that has no OfferedFare)`,
    `const raw = j.data;`,
    `const resp = (raw && raw.responseData && raw.responseData.Response) ? raw.responseData.Response : raw;`,
    `// Results is the quoted flight; fall back to root if not wrapped`,
    `const d = resp.Results || resp;`,
    ``,
    `// Priority: Results.Fare.OfferedFare → Results.FareBreakdown[0].BaseFare+Tax (computed)`,
    `const fare = d.Fare || {};`,
    `const fb   = (d.FareBreakdown && d.FareBreakdown[0]) ? d.FareBreakdown[0] : {};`,
    ``,
    `const offeredFare   = fare.OfferedFare   || (fare.PublishedFare && fare.PublishedFare > 0 ? fare.PublishedFare : 0) || ((fb.BaseFare || 0) + (fb.Tax || 0)) || 0;`,
    `const baseFare      = fare.BaseFare      || fb.BaseFare      || 0;`,
    `const tax           = fare.Tax           || fb.Tax           || 0;`,
    `const yqTax         = fare.YQTax         || fb.YQTax         || 0;`,
    `const publishedFare = fare.PublishedFare  || 0;`,
    ``,
    `pm.collectionVariables.set('offeredFare',   String(offeredFare));`,
    `pm.collectionVariables.set('baseFare',       String(baseFare));`,
    `pm.collectionVariables.set('tax',            String(tax));`,
    `pm.collectionVariables.set('yqTax',          String(yqTax));`,
    `pm.collectionVariables.set('publishedFare',  String(publishedFare));`,
    `if (d.IsLCC !== undefined) pm.collectionVariables.set('isLCC', String(d.IsLCC));`,
    ``,
    `pm.test('OfferedFare > 0', () => pm.expect(offeredFare).to.be.above(0));`,
    `console.log('✅ OfferedFare: ₹' + offeredFare, '| BaseFare: ₹' + baseFare, '| Tax: ₹' + tax, '| YQTax: ₹' + yqTax);`,
    `console.log('ℹ️  IsLCC:', d.IsLCC, '→ use', d.IsLCC ? '⑤a Ticket-LCC' : '⑤b Book Non-LCC');`,
    `if (resp.IsPriceChanged) console.warn('⚠️  IsPriceChanged=true — price updated since search!');`,
];

const ssrScript = [
    ...assertOk('SSR'),
    `// SSR: responseData.Response has Baggage/MealDynamic/SeatDynamic`,
    `// Each is an array-of-arrays: Baggage[0] is the actual options array`,
    `const raw = j.data;`,
    `const d = (raw && raw.responseData && raw.responseData.Response) ? raw.responseData.Response : (raw || {});`,
    `const baggageOpts = (d.Baggage && d.Baggage[0]) ? d.Baggage[0] : [];`,
    `const mealOpts    = (d.MealDynamic && d.MealDynamic[0]) ? d.MealDynamic[0] : [];`,
    `const seatSegs    = d.SeatDynamic || [];`,
    `console.log('🧳 Baggage options:', baggageOpts.length, '| first:', baggageOpts[0] ? baggageOpts[0].Code : 'none');`,
    `console.log('🍱 Meal options:', mealOpts.length, '| first:', mealOpts[0] ? mealOpts[0].Code : 'none');`,
    `console.log('💺 Seat segments:', seatSegs.length);`,
    `pm.test('SSR returned ancillaries', () => pm.expect(baggageOpts.length + mealOpts.length).to.be.above(0));`,
];

const ticketScript = [
    `const j = pm.response.json();`,
    `pm.test('Ticket/Book 200', () => pm.expect(j.status_code).to.eql(200));`,
    `pm.test('success true', () => pm.expect(j.success).to.be.true);`,
    ``,
    `// Adivaha ticketForLcc wraps as: responseData.Response.Response.BookingId`,
    `// The outer Response has B2B2BStatus; the inner Response has BookingId/PNR`,
    `const raw = j.data;`,
    `const outerResp = (raw && raw.responseData && raw.responseData.Response) ? raw.responseData.Response : (raw || {});`,
    `// Inner Response (double-nested) holds the actual itinerary`,
    `const d = outerResp.Response || outerResp;`,
    ``,
    `const bookingId = String(d.BookingId || d.bookingId || outerResp.BookingId || '');`,
    `const pnr       = d.PNR || d.Pnr || d.pnr || outerResp.PNR || '';`,
    `const orderId   = raw && raw.order_id ? raw.order_id : (d.order_id || d.orderId || '');`,
    ``,
    `if (bookingId) pm.collectionVariables.set('bookingId', bookingId);`,
    `if (pnr)       pm.collectionVariables.set('pnr', pnr);`,
    `if (orderId)   pm.collectionVariables.set('orderId', orderId);`,
    ``,
    `// TicketId lives in FlightItinerary.Passenger[0].Ticket.TicketId`,
    `const itinerary = d.FlightItinerary || {};`,
    `const pax = itinerary.Passenger || d.Passenger || d.Passengers || [];`,
    `const paxObj = Array.isArray(pax) ? pax[0] : pax;`,
    `const ticketId = String((paxObj && paxObj.Ticket) ? paxObj.Ticket.TicketId : (paxObj && paxObj.TicketId ? paxObj.TicketId : ''));`,
    `if (ticketId) pm.collectionVariables.set('ticketId', ticketId);`,
    ``,
    `const status = d.Status || itinerary.Status || '';`,
    `console.log('🎉 BookingId:', bookingId, '| PNR:', pnr, '| Status:', status, '| TicketId:', ticketId);`,
    `pm.test('BookingId received', () => pm.expect(bookingId).to.be.a('string').and.not.empty);`,
    `pm.test('PNR received', () => pm.expect(pnr).to.be.a('string').and.not.empty);`,
];

const bookingDetailsScript = [
    ...assertOk('BookingDetails'),
    `const d = j.data?.responseData?.Response || j.data || {};`,
    `// Keep bookingId / pnr / orderId in sync from response`,
    `const bid = String(d.BookingId || d.bookingId || '');`,
    `const pnr = d.PNR || d.Pnr || '';`,
    `const oid = d.order_id || d.orderId || '';`,
    `if (bid) pm.collectionVariables.set('bookingId', bid);`,
    `if (pnr) pm.collectionVariables.set('pnr', pnr);`,
    `if (oid) pm.collectionVariables.set('orderId', oid);`,
    `// Extract ChangeRequestId if present`,
    `const crid = d.ChangeRequestId || '';`,
    `if (crid) pm.collectionVariables.set('changeRequestId', String(crid));`,
    `console.log('📋 BookingId:', bid, '| PNR:', pnr, '| Status:', d.BookingStatus || d.FlightItinerary?.BookingStatus);`,
];

const cancellationChargesScript = [
    ...assertOk('CancellationCharges'),
    `const d = j.data?.responseData?.Response || j.data || {};`,
    `console.log('💰 Cancellation charges:', JSON.stringify(d).substring(0, 300));`,
];

const cancelScript = [
    `const j = pm.response.json();`,
    `pm.test('Cancel 200', () => pm.expect(j.status_code).to.eql(200));`,
    `pm.test('success true', () => pm.expect(j.success).to.be.true);`,
    `const d = j.data?.responseData?.Response || j.data || {};`,
    `// Save ChangeRequestId for status polling`,
    `const crid = d.ChangeRequestId || '';`,
    `if (crid) pm.collectionVariables.set('changeRequestId', String(crid));`,
    `console.log('⚠️  Cancel response — ChangeRequestId:', crid, '| Status:', d.Status || d.status);`,
    `pm.test('ChangeRequestId received', () => pm.expect(String(crid)).to.not.be.empty);`,
];

const changeStatusScript = [
    ...assertOk('ChangeStatus'),
    `const d = j.data?.responseData?.Response || j.data || {};`,
    `console.log('🔄 Change status:', d.Status || d.ChangeStatus || JSON.stringify(d).substring(0, 200));`,
];

const calFareScript = [
    ...assertOk('CalendarFare'),
    `const d = j.data?.responseData?.Response || j.data || {};`,
    `const fares = d.Fares || d.CalendarFareList || [];`,
    `console.log('📅 Calendar fares returned:', fares.length);`,
    `if (fares.length) console.log('Sample:', JSON.stringify(fares[0]));`,
];

const fareRuleScript = [
    ...assertOk('FareRule'),
    `const d = j.data?.responseData?.Response || j.data || {};`,
    `const rules = d.FareRules || [];`,
    `console.log('📋 Fare rules returned:', rules.length);`,
    `if (rules[0]) console.log('Sample rule snippet:', String(rules[0].FareRuleDetail || '').substring(0, 200));`,
];

// ─── collection definition ─────────────────────────────────────────────────────

const collection = {
    info: {
        _postman_id: 'flyanytrip-v3-full',
        name: 'FlyAnyTrip — Complete API (Auto-Chain v3)',
        description:
            'Full backend collection with auto-saving scripts.\nRun top-to-bottom — zero copy-paste.\nFlow: Health → Token → Location → Search → FareRule → FareQuote → SSR → Ticket/Book → Booking Details → Cancellation → Calendar Fares',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },

    variable: [
        { key: 'base_url',        value: 'http://localhost:3000/api/v1', type: 'string' },
        { key: 'traceId',         value: '', type: 'string' },
        { key: 'resultIndex',     value: '', type: 'string' },
        { key: 'isLCC',           value: '', type: 'string' },
        { key: 'bookingId',       value: '', type: 'string' },
        { key: 'pnr',             value: '', type: 'string' },
        { key: 'orderId',         value: '', type: 'string' },
        { key: 'ticketId',        value: '', type: 'string' },
        { key: 'changeRequestId', value: '', type: 'string' },
        { key: 'offeredFare',     value: '0', type: 'string' },
        { key: 'baseFare',        value: '0', type: 'string' },
        { key: 'tax',             value: '0', type: 'string' },
        { key: 'yqTax',           value: '0', type: 'string' },
        { key: 'publishedFare',   value: '0', type: 'string' },
        { key: 'originIata',      value: 'DEL', type: 'string' },
        { key: 'destIata',        value: 'BOM', type: 'string' },
    ],

    item: [
        // ── FOLDER 1: Utility ──────────────────────────────────────────────────
        {
            name: '🔧 Utility',
            item: [
                makeGet(
                    '① Health Check — GET /api/v1/self',
                    '/self',
                    [],
                    [
                        `const j = pm.response.json();`,
                        `pm.test('Health 200', () => pm.expect(j.status_code).to.eql(200));`,
                        `pm.test('success true', () => pm.expect(j.success).to.be.true);`,
                        `console.log('✅ Server is up — message:', j.message);`,
                    ],
                ),
                makeGet(
                    '② Generate Token — GET /api/v1/flights/token',
                    '/flights/token',
                    [],
                    [
                        `const j = pm.response.json();`,
                        `pm.test('Token 200', () => pm.expect(j.status_code).to.eql(200));`,
                        `pm.test('success true', () => pm.expect(j.success).to.be.true);`,
                        `console.log('✅ Token generated server-side (cached). All subsequent calls use it automatically.');`,
                        `console.log('Message:', j.message);`,
                    ],
                ),
                makeGet(
                    '③ Airport Locations — GET /api/v1/flights/locations?term=delhi',
                    '/flights/locations',
                    [
                        { key: 'term', value: 'delhi' },
                        { key: 'limit', value: '5' },
                    ],
                    [
                        `const j = pm.response.json();`,
                        `pm.test('Locations 200', () => pm.expect(j.status_code).to.eql(200));`,
                        `pm.test('success true', () => pm.expect(j.success).to.be.true);`,
                        `const list = j.data || [];`,
                        `pm.test('Results not empty', () => pm.expect(list.length).to.be.above(0));`,
                        `console.log('📍 Total locations found:', list.length);`,
                        `if (list[0]) console.log('First result:', JSON.stringify(list[0]));`,
                    ],
                ),
            ],
        },

        // ── FOLDER 2: Booking Flow ─────────────────────────────────────────────
        {
            name: '✈️ Booking Flow',
            item: [
                makePost(
                    '① Search Flights  →  saves traceId, resultIndex, isLCC, originIata, destIata',
                    '/flights/search',
                    JSON.stringify(
                        {
                            From_IATACODE: 'DEL',
                            To_IATACODE: 'BOM',
                            departure_date: '2026-09-15',
                            return_date: '',
                            adults: '1',
                            children: '0',
                            infants: '0',
                            isoneway: 'Yes',
                            Flights_category: 'Economy',
                        },
                        null,
                        2,
                    ),
                    searchScript,
                ),
                makePost(
                    '② Fare Rule  →  uses {{traceId}} + {{resultIndex}} (auto-filled)',
                    '/flights/fare-rule',
                    JSON.stringify({ TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}' }, null, 2),
                    fareRuleScript,
                ),
                makePost(
                    '③ Fare Quote  →  saves offeredFare, baseFare, tax, publishedFare',
                    '/flights/fare-quote',
                    JSON.stringify({ TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}' }, null, 2),
                    fareQuoteScript,
                ),
                makePost(
                    '④ SSR — Ancillaries (Optional) → uses {{traceId}} + {{resultIndex}}',
                    '/flights/ssr',
                    JSON.stringify({ TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}' }, null, 2),
                    ssrScript,
                ),
                makePost(
                    '⑤a Issue Ticket — LCC (IsLCC=true)  →  saves bookingId, pnr, orderId, ticketId',
                    '/flights/ticket-lcc',
                    passengerBody(true),
                    ticketScript,
                ),
                makePost(
                    '⑤b Hold Booking — Non-LCC (IsLCC=false)  →  saves bookingId, pnr, orderId',
                    '/flights/book',
                    passengerBody(false),
                    ticketScript,
                ),
            ],
        },

        // ── FOLDER 3: Post-Booking ─────────────────────────────────────────────
        {
            name: '📋 Post-Booking',
            item: [
                makePost(
                    '① Booking Details (by BookingId)  →  refreshes bookingId, pnr, changeRequestId',
                    '/flights/booking-details',
                    JSON.stringify({ BookingId: '{{bookingId}}' }, null, 2),
                    bookingDetailsScript,
                ),
                makePost(
                    '② Booking Details (by PNR)  →  alternate lookup',
                    '/flights/booking-details',
                    JSON.stringify({ PNR: '{{pnr}}' }, null, 2),
                    bookingDetailsScript,
                ),
                makePost(
                    '③ Cancellation Charges  →  uses {{bookingId}}',
                    '/flights/cancellation-charges',
                    JSON.stringify({ BookingId: '{{bookingId}}' }, null, 2),
                    cancellationChargesScript,
                ),
                makePost(
                    '④ Cancel Ticket — FULL (RequestType=1) ⚠ IRREVERSIBLE',
                    '/flights/cancel',
                    JSON.stringify(
                        {
                            order_id: '{{orderId}}',
                            ChangeRequestData: {
                                RequestType: 1,
                                BookingId: '{{bookingId}}',
                            },
                        },
                        null,
                        2,
                    ),
                    cancelScript,
                ),
                makePost(
                    '⑤ Cancel Ticket — PARTIAL (RequestType=2) ⚠ IRREVERSIBLE',
                    '/flights/cancel',
                    JSON.stringify(
                        {
                            order_id: '{{orderId}}',
                            ChangeRequestData: {
                                RequestType: 2,
                                BookingId: '{{bookingId}}',
                                Sectors: [{ Origin: '{{originIata}}', Destination: '{{destIata}}' }],
                                TicketId: ['{{ticketId}}'],
                            },
                        },
                        null,
                        2,
                    ),
                    cancelScript,
                ),
                makePost(
                    '⑥ Change Status  →  uses {{changeRequestId}} (auto-filled after cancel)',
                    '/flights/change-status',
                    JSON.stringify({ ChangeRequestId: '{{changeRequestId}}' }, null, 2),
                    changeStatusScript,
                ),
            ],
        },

        // ── FOLDER 4: Fare Tools ───────────────────────────────────────────────
        {
            name: '📅 Fare Tools',
            item: [
                makePost(
                    '① Calendar Fare — Monthly  →  uses {{originIata}} + {{destIata}}',
                    '/flights/calendar-fare',
                    JSON.stringify(
                        {
                            From_IATACODE: '{{originIata}}',
                            To_IATACODE: '{{destIata}}',
                            departure_date: '2026-09-15',
                            Flights_category: 'Economy',
                        },
                        null,
                        2,
                    ),
                    calFareScript,
                ),
                makePost(
                    '② Calendar Fare — Single Day Update  →  uses {{originIata}} + {{destIata}}',
                    '/flights/calendar-fare-day',
                    JSON.stringify(
                        {
                            From_IATACODE: '{{originIata}}',
                            To_IATACODE: '{{destIata}}',
                            departure_date: '2026-09-15',
                            Flights_category: 'Economy',
                        },
                        null,
                        2,
                    ),
                    calFareScript,
                ),
            ],
        },
    ],
};

// ─── write to root ─────────────────────────────────────────────────────────────

const outPath = path.join(__dirname, '..', 'postman_collection.json');
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2), 'utf8');
console.log('✅ Postman collection written to:', outPath);
console.log('   Total folders:', collection.item.length);
collection.item.forEach((folder) => {
    console.log(`   📁 ${folder.name}: ${folder.item.length} requests`);
});
