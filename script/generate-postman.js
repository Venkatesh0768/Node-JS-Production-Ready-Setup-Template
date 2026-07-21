/**
 * Flyanytrip — Postman Collection Generator
 * Run: node script/generate-postman.js
 * Output: postman_collection.json (project root)
 */

const fs = require('fs');
const path = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────────

const testScript = (exec) => ({
    listen: 'test',
    script: { type: 'text/javascript', exec: Array.isArray(exec) ? exec : [exec] }
});

const postReq = (url, rawBody) => ({
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: JSON.stringify(rawBody, null, 2), options: { raw: { language: 'json' } } },
    url: { raw: `{{base_url}}${url}`, host: ['{{base_url}}'], path: url.split('/').filter(Boolean) }
});

const getReq = (url, query = []) => ({
    method: 'GET',
    header: [],
    url: {
        raw: `{{base_url}}${url}${query.length ? '?' + query.map(q => `${q.key}=${q.value}`).join('&') : ''}`,
        host: ['{{base_url}}'],
        path: url.split('/').filter(Boolean),
        ...(query.length && { query })
    }
});

// ── Tests scripts ─────────────────────────────────────────────────────────────

const T = {
    token: [
        "const j = pm.response.json();",
        "pm.test('Token generated (200)', () => pm.expect(j.status_code).to.eql(200));",
        "console.log('✅ Token cached server-side — all subsequent calls will use it automatically');"
    ],

    locations: [
        "const j = pm.response.json();",
        "pm.test('Locations returned (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const list = j.data || [];",
        "if (list.length) console.log('📍 First result:', JSON.stringify(list[0]));"
    ],

    search: [
        "const j = pm.response.json();",
        "pm.test('Search success (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data; if (!d || !d.TraceId) { console.error('❌ No TraceId'); return; }",
        "pm.collectionVariables.set('traceId', d.TraceId);",
        "const flights = [];",
        "(d.Results || []).forEach(seg => { (Array.isArray(seg) ? seg : [seg]).forEach(f => { if (f && f.ResultIndex) flights.push(f); }); });",
        "if (!flights.length) { console.error('❌ No flights found'); return; }",
        "const f = flights[0];",
        "pm.collectionVariables.set('resultIndex', f.ResultIndex);",
        "pm.collectionVariables.set('isLCC', String(f.IsLCC));",
        "const seg = f.Segments?.[0]?.[0] || f.Segments?.[0] || {};",
        "const orig = seg.Origin?.Airport?.AirportCode || ''; const dest = seg.Destination?.Airport?.AirportCode || '';",
        "if (orig) pm.collectionVariables.set('originIata', orig);",
        "if (dest) pm.collectionVariables.set('destIata', dest);",
        "console.log(`✅ TraceId: ${d.TraceId}`);",
        "console.log(`✅ ResultIndex: ${f.ResultIndex} | IsLCC: ${f.IsLCC} | Fare: ₹${f.Fare?.OfferedFare} | ${orig}→${dest}`);",
        "console.log(`📊 ${flights.length} flights found`);"
    ],

    fareRule: [
        "const j = pm.response.json();",
        "pm.test('Fare rule (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const rules = j.data?.FareRules || j.data?.responseData?.Response?.FareRules || [];",
        "if (rules[0]) console.log('📋 Rule:', (rules[0].FareRuleDetail || '').substring(0, 120) + '...');"
    ],

    fareQuote: [
        "const j = pm.response.json();",
        "pm.test('Fare quote (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "const fb = d.FareBreakdown?.[0] || d.Fare || {};",
        "const offered = fb.OfferedFare || d.OfferedFare || 0;",
        "const base    = fb.BaseFare    || 0;",
        "const tax     = fb.Tax         || 0;",
        "const pub     = fb.PublishedFare || 0;",
        "pm.collectionVariables.set('offeredFare',   String(offered));",
        "pm.collectionVariables.set('baseFare',      String(base));",
        "pm.collectionVariables.set('tax',           String(tax));",
        "pm.collectionVariables.set('publishedFare', String(pub));",
        "if (d.IsLCC !== undefined) pm.collectionVariables.set('isLCC', String(d.IsLCC));",
        "pm.test('OfferedFare > 0', () => pm.expect(offered).to.be.above(0));",
        "console.log(`✅ OfferedFare: ₹${offered} | BaseFare: ₹${base} | Tax: ₹${tax}`);",
        "console.log(`ℹ️  IsLCC: ${d.IsLCC} → use ${d.IsLCC ? '⑤a Ticket(LCC)' : '⑤b Book(Non-LCC)'}`);"
    ],

    ssr: [
        "const j = pm.response.json();",
        "pm.test('SSR (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "console.log('🧳 Baggage:', JSON.stringify((d.Baggage||[]).slice(0,2)));",
        "console.log('🍱 Meal:',    JSON.stringify((d.MealDynamic||[]).slice(0,2)));",
        "console.log('💺 Seat:',    JSON.stringify((d.SeatDynamic||[]).slice(0,2)));"
    ],

    ticketLcc: [
        "const j = pm.response.json();",
        "pm.test('Ticket issued (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "const bid = d.BookingId || d.bookingId || '';",
        "const pnr = d.PNR || d.Pnr || d.pnr || '';",
        "const oid = d.order_id || d.orderId || '';",
        "if (bid) pm.collectionVariables.set('bookingId', String(bid));",
        "if (pnr) pm.collectionVariables.set('pnr', pnr);",
        "if (oid) pm.collectionVariables.set('orderId', oid);",
        "const pax = d.Passenger || d.Passengers || [];",
        "const tid = (Array.isArray(pax) ? pax[0] : pax)?.Ticket?.TicketId || '';",
        "if (tid) pm.collectionVariables.set('ticketId', String(tid));",
        "console.log(`🎉 BookingId: ${bid} | PNR: ${pnr} | order_id: ${oid} | TicketId: ${tid}`);"
    ],

    bookNonLcc: [
        "const j = pm.response.json();",
        "pm.test('Booking held (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "const bid = d.BookingId || d.bookingId || '';",
        "const pnr = d.PNR || d.Pnr || d.pnr || '';",
        "const oid = d.order_id || d.orderId || '';",
        "if (bid) pm.collectionVariables.set('bookingId', String(bid));",
        "if (pnr) pm.collectionVariables.set('pnr', pnr);",
        "if (oid) pm.collectionVariables.set('orderId', oid);",
        "console.log(`📋 Held — BookingId: ${bid} | PNR: ${pnr} | order_id: ${oid}`);"
    ],

    bookingDetails: [
        "const j = pm.response.json();",
        "pm.test('Booking details (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "const statusMap = {1:'Confirmed',2:'Cancelled',3:'CancellationPending',4:'RefundPending',5:'Issued',6:'Expired',7:'PartialCancellation'};",
        "console.log(`📄 Status: ${statusMap[d.Status]||d.Status} | PNR: ${d.PNR} | Airline: ${d.AirlineCode}`);"
    ],

    cancelCharges: [
        "const j = pm.response.json();",
        "pm.test('Charges returned (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "console.log(`💰 Charge: ₹${d.CancellationCharge} | Refund: ₹${d.RefundAmount}`);"
    ],

    cancelFull: [
        "const j = pm.response.json();",
        "pm.test('Cancellation submitted (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "const crid = d.ChangeRequestId || d.changeRequestId || '';",
        "if (crid) { pm.collectionVariables.set('changeRequestId', String(crid)); console.log(`✅ ChangeRequestId: ${crid}`); }"
    ],

    cancelPartial: [
        "const j = pm.response.json();",
        "pm.test('Partial cancel submitted (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "const crid = d.ChangeRequestId || d.changeRequestId || '';",
        "if (crid) { pm.collectionVariables.set('changeRequestId', String(crid)); console.log(`✅ ChangeRequestId: ${crid}`); }"
    ],

    changeStatus: [
        "const j = pm.response.json();",
        "pm.test('Status returned (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const d = j.data?.responseData?.Response || j.data || {};",
        "const map = {0:'Pending',1:'Confirmed',2:'Failed',3:'Processing'};",
        "console.log(`🔍 Status: ${map[d.ChangeRequestStatus]||d.ChangeRequestStatus} | Refund: ₹${d.RefundAmount}`);"
    ],

    calFare: [
        "const j = pm.response.json();",
        "pm.test('Calendar fare (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const r = j.data?.responseData?.Response?.SearchResults || j.data?.SearchResults || [];",
        "if (!r.length) return;",
        "const ch = r.reduce((a,b) => a.Fare < b.Fare ? a : b);",
        "console.log(`📅 ${r.length} days | Cheapest: ₹${ch.Fare} on ${(ch.DepartureDate||'').substring(0,10)} — ${ch.AirlineName||ch.AirlineCode}`);",
        "if (ch.DepartureDate) { const d = ch.DepartureDate.substring(0,10); pm.collectionVariables.set('calDayDate', d); console.log(`✅ calDayDate = ${d}`); }"
    ],

    calFareDay: [
        "const j = pm.response.json();",
        "pm.test('Day fare (200)', () => pm.expect(j.status_code).to.eql(200));",
        "const r = j.data?.responseData?.Response?.SearchResults || j.data?.SearchResults || [];",
        "if (r[0]) console.log(`📆 ₹${r[0].Fare} on ${(r[0].DepartureDate||'').substring(0,10)} — ${r[0].AirlineName||r[0].AirlineCode}`);"
    ]
};

// ── Fare body helper ──────────────────────────────────────────────────────────

const fareBody = (extra = {}) => ({
    ...extra,
    Fare: {
        Currency: 'INR',
        BaseFare: '{{baseFare}}',
        Tax: '{{tax}}',
        YQTax: 0,
        PublishedFare: '{{publishedFare}}',
        OfferedFare: '{{offeredFare}}',
        OtherCharges: 0,
        Discount: 0,
        TdsOnCommission: 0,
        TdsOnPLB: 0,
        TdsOnIncentive: 0,
        AdditionalTxnFeePub: 0,
        AdditionalTxnFeeOfrd: 0,
        ServiceFee: 0
    }
});

// ── Collection object ─────────────────────────────────────────────────────────

const collection = {
    info: {
        _postman_id: 'flyanytrip-v2',
        name: 'Flyanytrip — Adivaha API (Auto-Chain)',
        description: 'Every response auto-saves variables. Run top-to-bottom — zero copy-paste.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    variable: [
        { key: 'base_url',        value: 'http://localhost:3000/api/v1' },
        { key: 'traceId',         value: '' },
        { key: 'resultIndex',     value: '' },
        { key: 'isLCC',           value: '' },
        { key: 'bookingId',       value: '' },
        { key: 'pnr',             value: '' },
        { key: 'orderId',         value: '' },
        { key: 'ticketId',        value: '' },
        { key: 'changeRequestId', value: '' },
        { key: 'offeredFare',     value: '0' },
        { key: 'baseFare',        value: '0' },
        { key: 'tax',             value: '0' },
        { key: 'publishedFare',   value: '0' },
        { key: 'originIata',      value: 'DEL' },
        { key: 'destIata',        value: 'BOM' },
        { key: 'calDayDate',      value: '2026-09-15' }
    ],
    item: [
        {
            name: '🔧 Utility',
            item: [
                {
                    name: '① Generate Token',
                    event: [testScript(T.token)],
                    request: getReq('/flights/token')
                },
                {
                    name: 'Airport Locations',
                    event: [testScript(T.locations)],
                    request: getReq('/flights/locations', [
                        { key: 'term', value: 'delhi' },
                        { key: 'limit', value: '5' }
                    ])
                }
            ]
        },
        {
            name: '✈ Booking Flow',
            item: [
                {
                    name: '① Search Flights  →  saves TraceId + ResultIndex',
                    event: [testScript(T.search)],
                    request: postReq('/flights/search', {
                        adults: '1', children: '0', infants: '0',
                        isoneway: 'Yes', From_IATACODE: 'DEL', To_IATACODE: 'BOM',
                        departure_date: '2026-09-15', return_date: '', Flights_category: 'Economy'
                    })
                },
                {
                    name: '② Fare Rule  →  uses auto TraceId + ResultIndex',
                    event: [testScript(T.fareRule)],
                    request: postReq('/flights/fare-rule', {
                        TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}'
                    })
                },
                {
                    name: '③ Fare Quote  →  saves fare fields + IsLCC',
                    event: [testScript(T.fareQuote)],
                    request: postReq('/flights/fare-quote', {
                        TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}'
                    })
                },
                {
                    name: '④ SSR — Ancillaries (Optional)',
                    event: [testScript(T.ssr)],
                    request: postReq('/flights/ssr', {
                        TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}'
                    })
                },
                {
                    name: '⑤a Issue Ticket — LCC  →  saves BookingId / PNR / orderId',
                    event: [testScript(T.ticketLcc)],
                    request: postReq('/flights/ticket-lcc', {
                        TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}',
                        IsLCC: '1', isoneway: 'Yes', IsDomesticReturn: 'No',
                        Passengers: [{
                            Title: 'Mr', FirstName: 'Rahul', LastName: 'Sharma',
                            PaxType: '1', DateOfBirth: '1995-07-17T00:00:00', Gender: 1,
                            PassportNo: '', PassportExpiry: '',
                            AddressLine1: 'D-88, Sector 12', AddressLine2: '',
                            City: 'Delhi', CountryCode: 'IN', CountryName: 'India',
                            Nationality: 'IN', ContactNo: '9999999999',
                            Email: 'rahul@example.com', IsLeadPax: true,
                            ...fareBody(),
                            GSTCompanyAddress: null, GSTCompanyContactNumber: null,
                            GSTCompanyName: null, GSTNumber: null, GSTCompanyEmail: null,
                            Baggage: [], MealDynamic: [], SeatDynamic: []
                        }]
                    })
                },
                {
                    name: '⑤b Hold Booking — Non-LCC  →  saves BookingId / PNR / orderId',
                    event: [testScript(T.bookNonLcc)],
                    request: postReq('/flights/book', {
                        TraceId: '{{traceId}}', ResultIndex: '{{resultIndex}}',
                        IsLCC: '0', isoneway: 'Yes', IsDomesticReturn: 'No',
                        Passengers: [{
                            Title: 'Mr', FirstName: 'Test', LastName: 'Booking',
                            PaxType: '1', DateOfBirth: '1990-01-01T00:00:00Z', Gender: 1,
                            PassportNo: null, PassportExpiry: null, PassportIssueCountryCode: null,
                            AddressLine1: 'D33', AddressLine2: '',
                            City: 'Delhi', CountryCode: 'IN', CountryName: 'India',
                            Nationality: 'IN', ContactNo: '9999999999', CellCountryCode: '+91',
                            Email: 'test@gmail.com', IsLeadPax: true,
                            ...fareBody(),
                            GSTCompanyAddress: null, GSTCompanyContactNumber: null,
                            GSTCompanyName: null, GSTNumber: null
                        }]
                    })
                }
            ]
        },
        {
            name: '📋 Post-Booking',
            item: [
                {
                    name: 'Get Booking Details',
                    event: [testScript(T.bookingDetails)],
                    request: postReq('/flights/booking-details', {
                        BookingId: '{{bookingId}}', PNR: '{{pnr}}'
                    })
                },
                {
                    name: 'Get Cancellation Charges',
                    event: [testScript(T.cancelCharges)],
                    request: postReq('/flights/cancellation-charges', {
                        BookingId: '{{bookingId}}', RequestType: '1'
                    })
                },
                {
                    name: 'Cancel Ticket — Full ⚠ IRREVERSIBLE  →  saves ChangeRequestId',
                    event: [testScript(T.cancelFull)],
                    request: postReq('/flights/cancel', {
                        order_id: '{{orderId}}',
                        ChangeRequestData: {
                            BookingId: '{{bookingId}}',
                            RequestType: 1, CancellationType: 1,
                            Remarks: 'Cancellation request', EndUserIp: '192.168.1.1'
                        }
                    })
                },
                {
                    name: 'Cancel Ticket — Partial ⚠ IRREVERSIBLE  →  saves ChangeRequestId',
                    event: [testScript(T.cancelPartial)],
                    request: postReq('/flights/cancel', {
                        order_id: '{{orderId}}',
                        ChangeRequestData: {
                            BookingId: '{{bookingId}}',
                            RequestType: 2, CancellationType: 2,
                            Remarks: 'Partial cancellation', EndUserIp: '192.168.1.1',
                            Sectors: [{ Origin: '{{originIata}}', Destination: '{{destIata}}' }],
                            TicketId: ['{{ticketId}}']
                        }
                    })
                },
                {
                    name: 'Check Cancel / Refund Status',
                    event: [testScript(T.changeStatus)],
                    request: postReq('/flights/change-status', {
                        ChangeRequestId: '{{changeRequestId}}'
                    })
                }
            ]
        },
        {
            name: '📅 Fare Tools',
            item: [
                {
                    name: 'Calendar Fare — Monthly  →  saves cheapest date',
                    event: [testScript(T.calFare)],
                    request: postReq('/flights/calendar-fare', {
                        From_IATACODE: 'DEL', To_IATACODE: 'BOM',
                        departure_date: '2026-09-01', Flights_category: 'Economy'
                    })
                },
                {
                    name: 'Calendar Fare — Single Day  →  uses auto calDayDate',
                    event: [testScript(T.calFareDay)],
                    request: postReq('/flights/calendar-fare-day', {
                        From_IATACODE: 'DEL', To_IATACODE: 'BOM',
                        departure_date: '{{calDayDate}}', Flights_category: 'Economy'
                    })
                }
            ]
        }
    ]
};

// ── Write output ──────────────────────────────────────────────────────────────

const out = path.join(__dirname, '..', 'postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2), 'utf8');
console.log('✅ postman_collection.json written to', out);
