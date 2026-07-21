# Implementation Plan: Flyanytrip Backend

## Overview

Implement a secure orchestration proxy in the existing Node.js/TypeScript/Express scaffold that forwards all flight-booking lifecycle calls to the Adivaha Flight API. The implementation adds: configuration fields and startup guards, a daily token cache, a centralised Adivaha service, route-level validation middleware, a flight controller with 14 handlers, a flight router, environment variable documentation, and a Postman v2.1 collection. All new code follows the conventions already established in the scaffold (`httpResponse`/`httpError`, `logger`, `config`).

---

## Tasks

- [x] 1. Install dependencies and extend environment configuration
  - [x] 1.1 Install `axios` as a production dependency
    - Run `npm install axios` in the project root
    - Verify `axios` appears under `"dependencies"` in `package.json`
    - _Requirements: 16.5_

  - [x] 1.2 Install test dependencies
    - Run `npm install --save-dev fast-check vitest @vitest/coverage-v8 axios-mock-adapter`
    - Add `"test": "vitest --run"` and `"test:watch": "vitest"` scripts to `package.json`
    - Create `vitest.config.ts` at project root (set `include: ['test/**/*.ts']`, `environment: 'node'`)
    - _Requirements: (testing infrastructure)_

  - [x] 1.3 Add Adivaha env vars to `.env.development` and `.env.example`
    - Append `ADIVAHA_BASE_URL=https://api.adivaha.io/flights/api/` to both files
    - Append `PID=your_pid_here` and `X_API_KEY=your_api_key_here` as placeholder values
    - `.env.production` should list the variable names without values (secrets managed outside repo)
    - _Requirements: 1.1_

  - [x] 1.4 Extend `src/config/config.ts` with Adivaha fields
    - Add `ADIVAHA_BASE_URL: process.env.ADIVAHA_BASE_URL ?? 'https://api.adivaha.io/flights/api/'`
    - Add `PID: process.env.PID`
    - Add `X_API_KEY: process.env.X_API_KEY`
    - Keep all existing fields (`ENV`, `PORT`, `SERVER_URL`, `DATABASE_URL`) unchanged
    - _Requirements: 1.1_

  - [x] 1.5 Add startup validation to `src/server.ts`
    - Import `config` and `logger` (already present)
    - Before `app.listen`, check `if (!config.PID || !config.X_API_KEY)` and call `logger.error(...)` then `process.exit(1)`
    - The guard must run before the HTTP server binds to the port
    - _Requirements: 1.2_

- [x] 2. Extend constants and add shared response messages
  - [x] 2.1 Extend `src/constant/responseMessage.ts` with all new constants
    - Add `TOKEN_GENERATED: 'Authentication token generated successfully'`
    - Add `FARE_UNAVAILABLE: 'Fare is no longer available — please re-search for current fares'`
    - Add `TOKEN_EXPIRED: 'Authentication token expired and could not be refreshed'`
    - Add `ADIVAHA_UNREACHABLE: 'Adivaha API is currently unreachable'`
    - Add `PARTIAL_CANCEL_FIELDS_REQUIRED: 'Sectors and TicketId are required for partial cancellation (RequestType 2)'`
    - Add `CANCELLATION_WARNING: 'Cancellation is irreversible — forwarding to Adivaha'`
    - Add `INVALID_OFFERED_FARE: 'OfferedFare must be a positive non-zero value'`
    - Keep existing constants (`SUCCESS`, `SOMETHING_WENT_WRONG`, `NOT_FOUND`) unchanged
    - _Requirements: 18.4_

- [x] 3. Implement the token cache module
  - [x] 3.1 Create `src/service/tokenCache.ts`
    - Define a module-level `TokenCacheState` interface with `token: string | null` and `obtainedAt: number | null`
    - Initialise a private singleton object `{ token: null, obtainedAt: null }`
    - Export `getToken(): string | null` — returns `null` if `obtainedAt` is from a previous UTC calendar day (compare `new Date(obtainedAt).toDateString()` with `new Date().toDateString()`)
    - Export `setToken(token: string): void` — stores token and records `Date.now()` as `obtainedAt`
    - Export `clearToken(): void` — resets both fields to `null`
    - _Requirements: 2.1_

  - [ ]* 3.2 Write property test for token cache round-trip (Property 8)
    - **Property 8: Token Cache Round-Trip**
    - **Validates: Requirements 2.1**
    - File: `test/pbt/tokenCacheRoundTrip.pbt.ts`
    - Use `fc.string({ minLength: 1 })` as the token generator
    - Assert: `setToken(t); getToken() === t` (same UTC day)
    - Assert (clear): `setToken(t); clearToken(); getToken() === null`
    - Run minimum 100 iterations

  - [ ]* 3.3 Write unit tests for `tokenCache`
    - File: `test/unit/tokenCache.test.ts`
    - Test: `getToken()` returns `null` when cache is cold (no token set)
    - Test: `getToken()` returns `null` when `obtainedAt` is in a previous UTC day (mock `Date.now` or manipulate `obtainedAt`)
    - Test: `setToken` then `getToken` within the same day returns the stored string
    - Test: `clearToken` resets to `null`
    - _Requirements: 2.1_

- [ ] 4. Implement the Adivaha service
  - [x] 4.1 Create `src/service/adivahaService.ts` — axios instance and token helpers
    - Import `axios` and create a shared instance: `axios.create({ baseURL: config.ADIVAHA_BASE_URL })`
    - Add a request interceptor that attaches `{ PID: config.PID, 'x-api-key': config.X_API_KEY }` headers before every request
    - Implement `createToken()`: POST to `createToken` endpoint, call `setToken(response.token)`, return the response
    - Implement a private `ensureToken()` helper: calls `getToken()`; if `null`, calls `createToken()` first
    - _Requirements: 16.1, 16.2, 16.5, 2.2_

  - [x] 4.2 Implement `adivahaService` — core request wrapper with retry logic
    - Implement a private `callAdivaha<T>(fn: () => Promise<T>): Promise<T>` wrapper that:
      1. Calls `ensureToken()` before `fn()`
      2. Catches responses where `response.data.ErrorCode === 6`, calls `clearToken()` then `createToken()`, retries `fn()` exactly once
      3. If the retry also returns `ErrorCode === 6`, throws an `Error` with `responseMessage.TOKEN_EXPIRED`
      4. On network error (axios `!error.response`), throws an `Error` with `responseMessage.ADIVAHA_UNREACHABLE`
      5. On non-2xx HTTP status (not ErrorCode 6), throws with `{ adivahaStatus, adivahaBody }`
    - Logs each request at `info` level and each error at `error` level using `logger`
    - _Requirements: 2.3, 2.4, 16.3, 16.4, 16.6, 18.1, 18.2_

  - [ ] 4.3 Implement all 14 proxy methods in `adivahaService`
    - Each method calls `callAdivaha(() => adivahaAxios.get/post(...))` and returns `response.data`
    - `flightLocations(term, limit?)` → GET `flightLocations?term=...&limit=...`
    - `searchFlights(body)` → POST `searchFlights`
    - `fareRule(body)` → POST `fareRule`
    - `fareQuote(body)` → POST `fareQuote`
    - `flightSSR(body)` → POST `flightSSR`
    - `ticketForLcc(body)` → POST `ticketForLcc`
    - `flightBook(body)` → POST `flightBook`
    - `getBookingDetails(body)` → POST `getBookingDetails`
    - `getCancellationCharges(body)` → POST `getCancellationCharges`
    - `ticketCancel(body)` → POST `ticketCancel`
    - `checkChangeStatus(body)` → POST `checkChangeStatus`
    - `getCalendarFare(body)` → POST `GetCalendarFare`
    - `updateCalendarFareOfDay(body)` → POST `UpdateCalendarFareOfDay`
    - _Requirements: 3.2, 4.2, 5.2, 6.2, 7.2, 8.2, 9.2, 10.2, 11.2, 12.2, 13.2, 14.2, 15.2, 16.1_

  - [ ]* 4.4 Write property test for token header injection (Property 1)
    - **Property 1: Token Header Injection**
    - **Validates: Requirements 16.2, 4.2**
    - File: `test/pbt/tokenInjection.pbt.ts`
    - Use `axios-mock-adapter` to intercept outbound requests; capture request config headers
    - Generator: pick an arbitrary service method name; generate an arbitrary request body object
    - Assert: every captured request has `headers.PID === config.PID` and `headers['x-api-key'] === config.X_API_KEY`
    - Run minimum 100 iterations

  - [ ]* 4.5 Write property test for token retry idempotency (Property 6)
    - **Property 6: Token Retry Idempotency**
    - **Validates: Requirements 2.3, 2.4, 16.4**
    - File: `test/pbt/tokenRetryIdempotency.pbt.ts`
    - Mock first Adivaha response to return `{ ErrorCode: 6 }`, second to return success
    - Assert: `createToken` called exactly once; original endpoint called exactly twice
    - Assert (double failure path): if retry also returns `ErrorCode: 6`, `createToken` still called once, error thrown with status 502
    - Run minimum 100 iterations

  - [ ]* 4.6 Write unit tests for `adivahaService`
    - File: `test/unit/adivahaService.test.ts`
    - Test: network error (mock `axios` to reject with no `response`) → throws error with `ADIVAHA_UNREACHABLE` message
    - Test: Adivaha returns 4xx → throws error carrying Adivaha status and body
    - Test: `createToken()` calls `setToken` with the returned token string
    - _Requirements: 16.3, 16.4, 18.1, 18.2_

- [~] 5. Checkpoint — token cache and service layer
  - Ensure all tests written so far pass. Ask the user if questions arise before continuing.

- [ ] 6. Implement utility and middleware
  - [~] 6.1 Create `src/util/isDomesticRoute.ts`
    - Define the `INDIAN_IATA_CODES` Set with all IATA codes from the design document
    - Export `isDomesticRoute(from: string, to: string): 'Yes' | 'No'`
    - Logic: `INDIAN_IATA_CODES.has(from.toUpperCase()) && INDIAN_IATA_CODES.has(to.toUpperCase()) ? 'Yes' : 'No'`
    - Function must be pure — no imports of external state
    - _Requirements: 4.5_

  - [ ]* 6.2 Write property test for isDomesticRoute determinism (Property 5)
    - **Property 5: isDomesticRoute Determinism**
    - **Validates: Requirements 4.5**
    - File: `test/pbt/isDomesticDeterminism.pbt.ts`
    - Generator A: two codes drawn from `INDIAN_IATA_CODES` via `fc.constantFrom(...INDIAN_IATA_CODES)`
    - Generator B: at least one code not in the set (filter `fc.string()`)
    - Assert A: `isDomesticRoute(from, to) === 'Yes'`
    - Assert B: `isDomesticRoute(from, to) === 'No'`
    - Run minimum 100 iterations

  - [ ]* 6.3 Write unit tests for `isDomesticRoute`
    - File: `test/unit/isDomesticRoute.test.ts`
    - Test: both Indian codes → `'Yes'`
    - Test: one foreign code → `'No'`
    - Test: lowercase codes are normalised correctly
    - Test: empty string → `'No'`
    - _Requirements: 4.5_

  - [x] 6.4 Create `src/middleware/validateBody.ts`
    - Note: new `src/middleware/` folder (correct spelling); existing typo folder `src/middlerware/` is untouched
    - Export `validateBody(...fields: string[]): RequestHandler`
    - For each field, check `req.body[field]` — if `undefined`, `null`, or `''`, call `httpError(next, new Error(\`Missing required body field: \${field}\`), req, 400)` and return
    - If all fields pass, call `next()`
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 6.5 Create `src/middleware/validateQuery.ts`
    - Same factory pattern as `validateBody` but reads from `req.query`
    - Export `validateQuery(...fields: string[]): RequestHandler`
    - _Requirements: 17.4_

  - [ ]* 6.6 Write property test for secret non-exposure (Property 7)
    - **Property 7: Secret Non-Exposure**
    - **Validates: Requirements 1.3**
    - File: `test/pbt/secretNonExposure.pbt.ts`
    - Mock `adivahaService` to return arbitrary response bodies (including strings containing "PID")
    - Capture full `res.json()` output and serialize to string
    - Assert: serialized output does not contain the literal value of `config.PID` or `config.X_API_KEY`
    - Run minimum 100 iterations

  - [ ]* 6.7 Write unit tests for validation middleware
    - File: `test/unit/validateBody.test.ts` and `test/unit/validateQuery.test.ts`
    - `validateBody`: test passes when all required fields present; test calls `next(error)` with 400 when a field is missing; test rejects empty string values
    - `validateQuery`: same assertions applied to `req.query`
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [ ] 7. Implement the flight controller
  - [~] 7.1 Create `src/controller/flightController.ts` — token, locations, search
    - Follow the `apiController.ts` pattern: each handler is `async (req, res, next) => { try { ... } catch (error) { httpError(next, error, req, statusCode) } }`
    - `getToken`: call `adivahaService.createToken()`, respond with `httpResponse(req, res, 200, responseMessage.TOKEN_GENERATED)`; do NOT include the token value in the response
    - `getLocations`: read `req.query.term` and `req.query.limit` (default `5`), call `adivahaService.flightLocations(term, limit)`, respond 200
    - `searchFlights`: read body, compute `isDomestic = isDomesticRoute(body.From_IATACODE, body.To_IATACODE)`, inject into forwarded body, call `adivahaService.searchFlights(payload)`, respond 200
    - _Requirements: 2.5, 3.2, 3.4, 4.2, 4.3, 4.5_

  - [~] 7.2 Add fare handlers to `flightController.ts`
    - `getFareRule`: forward body to `adivahaService.fareRule(body)`, respond 200
    - `getFareQuote`: call `adivahaService.fareQuote(body)`; if `result.OfferedFare === 0` return `httpError(next, new Error(responseMessage.FARE_UNAVAILABLE), req, 422)`; otherwise respond 200
    - `getSSR`: forward body to `adivahaService.flightSSR(body)`, respond 200
    - _Requirements: 5.2, 5.4, 6.2, 6.3, 6.4, 7.2, 7.4_

  - [~] 7.3 Add ticketing handlers to `flightController.ts`
    - `ticketLcc`: validate `body.Passengers?.[0]?.Fare?.OfferedFare` — if `<= 0` or absent, return 422 via `httpError` with `responseMessage.INVALID_OFFERED_FARE`; otherwise forward to `adivahaService.ticketForLcc(body)`, respond 200
    - `bookFlight`: same OfferedFare guard, then forward to `adivahaService.flightBook(body)`, respond 200
    - _Requirements: 8.2, 8.3, 8.4, 9.2, 9.3, 9.4_

  - [~] 7.4 Add post-booking handlers to `flightController.ts`
    - `getBookingDetails`: if both `body.BookingId` and `body.PNR` are absent/empty, return `httpError(next, ..., req, 400)`; otherwise forward to `adivahaService.getBookingDetails(body)`, respond 200
    - `getCancellationCharges`: forward body to `adivahaService.getCancellationCharges(body)`, respond 200
    - `getChangeStatus`: forward body to `adivahaService.checkChangeStatus(body)`, respond 200
    - _Requirements: 10.2, 10.3, 10.4, 11.2, 11.4, 13.2, 13.4_

  - [~] 7.5 Add `cancelTicket` handler to `flightController.ts`
    - Log `logger.warn(responseMessage.CANCELLATION_WARNING)` before any Adivaha call
    - If `body.RequestType === 1`: build a clean payload from `body` omitting `Sectors` and `TicketId` keys, forward to `adivahaService.ticketCancel(cleanPayload)`, respond 200
    - If `body.RequestType === 2`: check `body.Sectors` and `body.TicketId` are arrays with `length > 0`; if not, return 400 via `httpError` with `responseMessage.PARTIAL_CANCEL_FIELDS_REQUIRED`; otherwise forward full body, respond 200
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [~] 7.6 Add calendar fare handlers to `flightController.ts`
    - `getCalendarFare`: forward body to `adivahaService.getCalendarFare(body)`, respond 200
    - `getCalendarFareDay`: forward body to `adivahaService.updateCalendarFareOfDay(body)`, respond 200
    - _Requirements: 14.2, 14.4, 15.2, 15.4_

  - [ ]* 7.7 Write property test for OfferedFare guard (Property 2)
    - **Property 2: OfferedFare Guard (Booking Calls)**
    - **Validates: Requirements 8.3, 9.3**
    - File: `test/pbt/offeredFareGuard.pbt.ts`
    - Generator: arbitrary Passengers array where `[0].Fare.OfferedFare` is one of `[0, null, undefined, -1, -999.99]` via `fc.oneof`
    - Assert: `next` is called with a 422 error object; `adivahaService.ticketForLcc` and `.flightBook` are never called

  - [ ]* 7.8 Write property test for full cancellation purity (Property 3)
    - **Property 3: Full Cancellation Purity**
    - **Validates: Requirements 12.2**
    - File: `test/pbt/fullCancelPurity.pbt.ts`
    - Generator: arbitrary cancel body with `RequestType: 1` plus arbitrary `Sectors` and `TicketId` arrays
    - Spy on `adivahaService.ticketCancel` and capture the argument
    - Assert: captured payload does NOT have a `Sectors` key and does NOT have a `TicketId` key

  - [ ]* 7.9 Write property test for partial cancellation completeness (Property 4)
    - **Property 4: Partial Cancellation Completeness**
    - **Validates: Requirements 12.3, 12.4**
    - File: `test/pbt/partialCancelCompleteness.pbt.ts`
    - Generator: cancel body with `RequestType: 2` where `Sectors` or `TicketId` is one of `[undefined, null, [], '']`
    - Assert: response status is 400; `adivahaService.ticketCancel` is never called

  - [ ]* 7.10 Write unit tests for `flightController`
    - File: `test/unit/flightController.test.ts`
    - Test: `getLocations` returns 400 when `term` is empty string
    - Test: `getFareQuote` returns 422 when `OfferedFare === 0` in Adivaha response
    - Test: `cancelTicket` with `RequestType=1` calls `logger.warn`
    - Test: `getBookingDetails` returns 400 when both `BookingId` and `PNR` are absent
    - _Requirements: 3.3, 6.4, 10.3, 12.7_

- [~] 8. Checkpoint — service, utilities, and controller
  - Ensure all tests pass. Verify that `httpError` flows through `gobalErrorHandler` correctly. Ask the user if questions arise before continuing.

- [ ] 9. Implement routing and wire everything together
  - [~] 9.1 Create `src/router/flightRouter.ts`
    - Import `Router` from Express, `flightController`, `validateBody`, and `validateQuery`
    - Define all 14 routes exactly as specified in the design:
      - `GET  /token` → `flightController.getToken`
      - `GET  /locations` → `validateQuery('term')`, `flightController.getLocations`
      - `POST /search` → `validateBody('From_IATACODE','To_IATACODE','departure_date','adults','children','infants','isoneway','Flights_category')`, `flightController.searchFlights`
      - `POST /fare-rule` → `validateBody('TraceId','ResultIndex')`, `flightController.getFareRule`
      - `POST /fare-quote` → `validateBody('TraceId','ResultIndex')`, `flightController.getFareQuote`
      - `POST /ssr` → `validateBody('TraceId','ResultIndex')`, `flightController.getSSR`
      - `POST /ticket-lcc` → `validateBody('TraceId','ResultIndex','Passengers')`, `flightController.ticketLcc`
      - `POST /book` → `validateBody('TraceId','ResultIndex','Passengers')`, `flightController.bookFlight`
      - `POST /booking-details` → `flightController.getBookingDetails` (custom guard in controller)
      - `POST /cancellation-charges` → `validateBody('BookingId')`, `flightController.getCancellationCharges`
      - `POST /cancel` → `validateBody('order_id','ChangeRequestData')`, `flightController.cancelTicket`
      - `POST /change-status` → `validateBody('ChangeRequestId')`, `flightController.getChangeStatus`
      - `POST /calendar-fare` → `validateBody('From_IATACODE','To_IATACODE','departure_date','Flights_category')`, `flightController.getCalendarFare`
      - `POST /calendar-fare-day` → `validateBody('From_IATACODE','To_IATACODE','departure_date','Flights_category')`, `flightController.getCalendarFareDay`
    - Export the router
    - _Requirements: 2.5, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1, 13.1, 14.1, 15.1_

  - [~] 9.2 Mount `flightRouter` in `src/router/apiRouter.ts`
    - Import `flightRouter` from `'./flightRouter'`
    - Add `router.use('/flights', flightRouter)` after the existing `/self` route
    - Keep the existing `/self` route unchanged
    - _Requirements: 3.1, 4.1, 5.1 (all endpoint path requirements)_

- [ ] 10. Create Postman collection
  - [~] 10.1 Create `postman_collection.json` at the project root
    - Format: Postman Collection v2.1 (`"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"`)
    - Collection variable: `base_url` with default value `http://localhost:3000/api/v1`
    - Organise requests into 4 named folders:
      1. **Utility** — `GET /flights/token`, `GET /flights/locations`
      2. **Booking Flow** — `POST /flights/search`, `POST /flights/fare-rule`, `POST /flights/fare-quote`, `POST /flights/ssr`, `POST /flights/ticket-lcc`, `POST /flights/book`
      3. **Post-Booking** — `POST /flights/booking-details`, `POST /flights/cancellation-charges`, `POST /flights/cancel`, `POST /flights/change-status`
      4. **Fare Tools** — `POST /flights/calendar-fare`, `POST /flights/calendar-fare-day`
    - Every POST request includes a realistic example JSON body (use design-documented field names)
    - GET requests use `{{base_url}}` query parameter examples
    - Collection must NOT contain real `PID` or `X_API_KEY` values
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [ ] 11. Integration tests
  - [ ]* 11.1 Write integration tests for the flight routes
    - File: `test/integration/flights.integration.test.ts`
    - Use the actual Express `app` with mocked `axios` (via `axios-mock-adapter`)
    - Test: `GET /api/v1/flights/token` → 200 with success message, no token value in body
    - Test: `POST /api/v1/flights/search` → verify `isDomestic` field appears in the forwarded axios call body
    - Test: server startup with missing `PID` → verify `process.exit` called with `1`
    - Test: server startup with all env vars present → verify no exit
    - _Requirements: 2.5, 4.5, 1.2_

- [~] 12. Final checkpoint — full integration
  - Ensure all tests pass (`npm test`). Verify TypeScript compiles cleanly (`npm run build`). Ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- Checkpoints (Tasks 5, 8, 12) ensure incremental validation at logical boundaries
- The existing `src/middlerware/` folder (typo) is left untouched; new middleware files go in the correctly-spelled `src/middleware/` folder
- Property tests validate universal correctness properties across many generated inputs; unit tests cover specific examples and edge cases
- The `validateBody` / `validateQuery` middleware uses the existing `httpError` utility so errors flow through `gobalErrorHandler` automatically
- `adivahaService` types request/response bodies as `unknown` to avoid premature coupling to Adivaha's schema

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1"] },
    { "id": 2, "tasks": ["1.5", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1", "6.4", "6.5"] },
    { "id": 4, "tasks": ["4.2", "6.1", "6.6", "6.7"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "4.6", "6.2", "6.3"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4"] },
    { "id": 8, "tasks": ["7.5", "7.6"] },
    { "id": 9, "tasks": ["7.7", "7.8", "7.9", "7.10"] },
    { "id": 10, "tasks": ["9.1"] },
    { "id": 11, "tasks": ["9.2", "10.1"] },
    { "id": 12, "tasks": ["11.1"] }
  ]
}
```
