# Design Document — Flyanytrip Backend

## Overview

The Flyanytrip Backend is a secure orchestration proxy built on the existing Node.js / TypeScript / Express scaffold. Its single responsibility is to sit between Flyanytrip client applications and the Adivaha Flight API (`api.adivaha.io/flights/api/`) — injecting all credentials server-side, managing daily authentication tokens, and normalising the request/response surface into a consistent REST API.

The backend covers the full flight booking lifecycle:
- **Airport lookup** — find IATA codes by city name
- **Flight search** — search available flights with one-way/return and passenger counts
- **Fare validation** — real-time fare rules, fare quote with OfferedFare confirmation, and SSR ancillaries
- **Ticket issuance** — separate paths for LCC (`ticketForLcc`) and non-LCC (`flightBook`) carriers
- **Post-booking** — booking details retrieval, cancellation charges, ticket cancellation, and change-status tracking
- **Calendar fare tools** — cheapest monthly fares and best fare for a specific day

All 14 booking-related endpoints are collected in a Postman v2.1 collection at the project root for immediate QA use.

---

## Architecture

The system follows the existing layered architecture already established in the scaffold:

```
Client
  │
  ▼
Express App  (src/app.ts)
  │
  ├─ Global Error Handler  (src/middlerware/gobalErrorHandler.ts)  [existing, unchanged]
  │
  └─ Router  /api/v1/  (src/router/apiRouter.ts)
       │
       ├─ /self          → apiController.self            [existing]
       └─ /flights       → flightRouter (new)
            │
            ├─ Validation Middleware  (validateBody / validateQuery)
            │
            └─ flightController  (new)
                 │
                 └─ adivahaService  (new)
                      │
                      ├─ tokenCache  (new)
                      └─ axios → Adivaha_API
```

**Key design decisions:**

1. **No new framework layers.** The feature adds files inside the established pattern (`controller`, `service`, `router`, `middleware`, `util`) without introducing new abstractions.
2. **Token managed in service layer only.** `tokenCache` is an internal singleton used exclusively by `adivahaService`. No controller touches the cache directly.
3. **Validation as composable middleware.** `validateBody` and `validateQuery` are factory functions that return standard Express `RequestHandler` instances, keeping route definitions declarative.
4. **axios chosen over `node-fetch` or `http`** because it provides interceptors, structured error objects with `response.data`, and is already the de-facto standard in this stack. It will be added as a production dependency.

---

## Components and Interfaces

### 1. Config Extension (`src/config/config.ts`)

Adds three new fields to the existing export. No structural change — pure field additions.

```typescript
export default {
  ENV: process.env.ENV,
  PORT: process.env.PORT,
  SERVER_URL: process.env.SERVER_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  ADIVAHA_BASE_URL: process.env.ADIVAHA_BASE_URL ?? 'https://api.adivaha.io/flights/api/',
  PID: process.env.PID,
  X_API_KEY: process.env.X_API_KEY,
};
```

Startup validation is added in `src/server.ts` as an early guard before the server binds:

```typescript
if (!config.PID || !config.X_API_KEY) {
  logger.error('FATAL: PID and X_API_KEY environment variables are required');
  process.exit(1);
}
```

---

### 2. Response Message Extension (`src/constant/responseMessage.ts`)

New constants appended to the existing export object:

| Constant | Value |
|---|---|
| `TOKEN_GENERATED` | `'Authentication token generated successfully'` |
| `FARE_UNAVAILABLE` | `'Fare is no longer available — please re-search for current fares'` |
| `TOKEN_EXPIRED` | `'Authentication token expired and could not be refreshed'` |
| `ADIVAHA_UNREACHABLE` | `'Adivaha API is currently unreachable'` |
| `PARTIAL_CANCEL_FIELDS_REQUIRED` | `'Sectors and TicketId are required for partial cancellation (RequestType 2)'` |
| `CANCELLATION_WARNING` | `'Cancellation is irreversible — forwarding to Adivaha'` |
| `INVALID_OFFERED_FARE` | `'OfferedFare must be a positive non-zero value'` |

---

### 3. Token Cache (`src/service/tokenCache.ts`)

Simple in-memory singleton. Token validity is the current UTC calendar day (midnight-to-midnight). The cache does **not** pre-emptively refresh; expiry is only detected via `ErrorCode_6` from Adivaha.

```typescript
interface TokenCache {
  token: string | null;
  obtainedAt: number | null; // UTC milliseconds
}

// Public API
export function getToken(): string | null
export function setToken(token: string): void
export function clearToken(): void
```

`getToken()` returns `null` if the stored token was obtained on a previous UTC calendar day (i.e., `obtainedAt` date differs from today's UTC date).

---

### 4. Adivaha Service (`src/service/adivahaService.ts`)

Central HTTP proxy. Every public method:
1. Calls `getToken()` — if `null`, calls `createToken()` and caches the result.
2. Attaches `PID` and `x-api-key` headers via a shared axios instance.
3. Checks the response body for `ErrorCode === 6` — if found, refreshes the token and retries once.
4. Logs the request at `info` level and any error at `error` level.

```typescript
// Shared axios instance (created once at module load)
const adivahaAxios = axios.create({
  baseURL: config.ADIVAHA_BASE_URL,
});

// All methods add headers before each request via a request interceptor:
// { PID: config.PID, 'x-api-key': config.X_API_KEY }

export const adivahaService = {
  createToken():              Promise<AdivahaTokenResponse>
  flightLocations(term: string, limit?: number): Promise<unknown>
  searchFlights(body: unknown):        Promise<unknown>
  fareRule(body: unknown):             Promise<unknown>
  fareQuote(body: unknown):            Promise<unknown>
  flightSSR(body: unknown):            Promise<unknown>
  ticketForLcc(body: unknown):         Promise<unknown>
  flightBook(body: unknown):           Promise<unknown>
  getBookingDetails(body: unknown):    Promise<unknown>
  getCancellationCharges(body: unknown): Promise<unknown>
  ticketCancel(body: unknown):         Promise<unknown>
  checkChangeStatus(body: unknown):    Promise<unknown>
  getCalendarFare(body: unknown):      Promise<unknown>
  updateCalendarFareOfDay(body: unknown): Promise<unknown>
}
```

**Error surface:**
- Network error (no response) → throws `Error` with message from `responseMessage.ADIVAHA_UNREACHABLE`; caller maps to HTTP 503.
- Non-2xx HTTP status from Adivaha → throws `Error` carrying `{ adivahaStatus, adivahaBody }`; caller maps to HTTP 502.
- Double `ErrorCode_6` (retry also fails) → throws `Error` with message from `responseMessage.TOKEN_EXPIRED`; caller maps to HTTP 502.

---

### 5. isDomesticRoute Helper (`src/util/isDomesticRoute.ts`)

Pure utility function with no side effects.

```typescript
const INDIAN_IATA_CODES = new Set<string>([
  'DEL','BOM','BLR','HYD','MAA','CCU','AMD','PNQ','JAI','GOI',
  'COK','LKO','ATQ','IXC','IXR','VNS','PAT','IXB','GAU','IXA',
  'IXZ','TRV','IXM','IDR','BHO','NAG','RAJ','STV','BDQ','UDR',
  'JDH','JLR','RPR','VTZ','IXE','SXR','TEZ','DIB','JRH','MZU',
  'HBX','BEK','KQH','VGA','BBI','CCJ','IXS','IXU','CDP','PUT',
  'OMC','TIR','KJB','IXY','GWL','JGA','KUU','LUH','SHL','DIU'
]);

export function isDomesticRoute(from: string, to: string): 'Yes' | 'No' {
  return INDIAN_IATA_CODES.has(from.toUpperCase()) &&
         INDIAN_IATA_CODES.has(to.toUpperCase())
    ? 'Yes'
    : 'No';
}
```

---

### 6. Validation Middleware

**`src/middleware/validateBody.ts`**

```typescript
export function validateBody(...fields: string[]): RequestHandler {
  return (req, _res, next) => {
    for (const field of fields) {
      const value = (req.body as Record<string, unknown>)[field];
      if (value === undefined || value === null || value === '') {
        return httpError(next, new Error(`Missing required body field: ${field}`), req, 400);
      }
    }
    next();
  };
}
```

**`src/middleware/validateQuery.ts`** — identical pattern but reads from `req.query`.

---

### 7. Flight Controller (`src/controller/flightController.ts`)

Each handler follows the established pattern from `apiController.ts`: `try/catch`, success via `httpResponse`, errors via `httpError`. Controller-specific business rules (OfferedFare guard, cancellation field stripping, partial cancel validation) are applied before delegating to `adivahaService`.

| Handler | Business rule |
|---|---|
| `getToken` | Calls `createToken()`, returns success message — no token value in response |
| `getLocations` | Forwards `term` and `limit` |
| `searchFlights` | Injects `isDomestic` from `isDomesticRoute(body.From_IATACODE, body.To_IATACODE)` |
| `getFareQuote` | Returns 422 if `response.data.OfferedFare === 0` |
| `ticketLcc` | Returns 422 if `body.Passengers[0].Fare.OfferedFare <= 0` |
| `bookFlight` | Same OfferedFare guard as `ticketLcc` |
| `cancelTicket` | RequestType=1 → strips `Sectors`/`TicketId` before forwarding; RequestType=2 → validates both present and non-empty; logs warning at `warn` level before any Adivaha call |
| All others | Straight proxy — no transformation |

---

### 8. Flight Router (`src/router/flightRouter.ts`)

```
GET  /token
GET  /locations              validateQuery('term')
POST /search                 validateBody('From_IATACODE','To_IATACODE','departure_date',
                                          'adults','children','infants','isoneway','Flights_category')
POST /fare-rule              validateBody('TraceId','ResultIndex')
POST /fare-quote             validateBody('TraceId','ResultIndex')
POST /ssr                    validateBody('TraceId','ResultIndex')
POST /ticket-lcc             validateBody('TraceId','ResultIndex','Passengers')
POST /book                   validateBody('TraceId','ResultIndex','Passengers')
POST /booking-details        (custom guard in controller: BookingId OR PNR)
POST /cancellation-charges   validateBody('BookingId')
POST /cancel                 validateBody('order_id','ChangeRequestData')
POST /change-status          validateBody('ChangeRequestId')
POST /calendar-fare          validateBody('From_IATACODE','To_IATACODE','departure_date','Flights_category')
POST /calendar-fare-day      validateBody('From_IATACODE','To_IATACODE','departure_date','Flights_category')
```

Mounted in `src/router/apiRouter.ts`:

```typescript
import flightRouter from './flightRouter';
router.use('/flights', flightRouter);
```

---

## Data Models

### TokenCache (in-memory, not persisted)

```typescript
interface TokenCacheState {
  token: string | null;
  obtainedAt: number | null; // Date.now() at time of setToken()
}
```

### THttpResponse / THttpError (existing, unchanged)

```typescript
// From src/types/types.ts — no changes needed
type THttpResponse = { success, status_code, request, message, data }
type THttpError    = { success, status_code, request, message, data, trace }
```

### Adivaha Request Bodies (pass-through)

Because the Backend is a proxy, Adivaha request/response bodies are typed as `unknown` in the service layer and `Record<string, unknown>` at controller boundaries. Strict typing of every Adivaha field is deferred to a future enhancement once Adivaha's OpenAPI spec is available. The only fields the Backend inspects are:

| Field | Where inspected | Type |
|---|---|---|
| `ErrorCode` | `adivahaService` — all responses | `number` |
| `OfferedFare` | `getFareQuote`, `ticketLcc`, `bookFlight` | `number` |
| `From_IATACODE`, `To_IATACODE` | `searchFlights` controller | `string` |
| `RequestType` | `cancelTicket` controller | `1 \| 2` |
| `Sectors`, `TicketId` | `cancelTicket` controller (strip or validate) | `unknown[]` |
| `Passengers[0].Fare.OfferedFare` | `ticketLcc`, `bookFlight` | `number` |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Token Header Injection

*For any* call to any `adivahaService` method, the outbound HTTP request dispatched by axios MUST carry a `PID` header equal to `config.PID` and an `x-api-key` header equal to `config.X_API_KEY`, regardless of which method is invoked or what the request body contains.

**Validates: Requirements 16.2, 4.2**

---

### Property 2: OfferedFare Guard (Booking Calls)

*For any* request to `POST /flights/ticket-lcc` or `POST /flights/book` where `Passengers[0].Fare.OfferedFare` is 0, absent, or negative, the backend MUST return HTTP 422 and MUST NOT dispatch any outbound request to the Adivaha API.

**Validates: Requirements 8.3, 9.3**

---

### Property 3: Full Cancellation Purity

*For any* request to `POST /flights/cancel` where `RequestType` equals 1 (full cancellation), the payload forwarded to the Adivaha `ticketCancel` endpoint MUST NOT contain a `Sectors` field or a `TicketId` field — regardless of whether the client included those fields in the original request.

**Validates: Requirements 12.2**

---

### Property 4: Partial Cancellation Completeness

*For any* request to `POST /flights/cancel` where `RequestType` equals 2 (partial cancellation) and either `Sectors` or `TicketId` is absent or an empty array, the backend MUST return HTTP 400 and MUST NOT forward the request to Adivaha.

**Validates: Requirements 12.3, 12.4**

---

### Property 5: isDomesticRoute Determinism

*For any* pair of IATA code strings `(from, to)`:
- If both codes (uppercased) are members of `INDIAN_IATA_CODES`, `isDomesticRoute(from, to)` MUST return `"Yes"`.
- If either code (uppercased) is not a member of `INDIAN_IATA_CODES`, `isDomesticRoute(from, to)` MUST return `"No"`.

The function MUST be pure — identical inputs always produce identical outputs with no side effects.

**Validates: Requirements 4.5**

---

### Property 6: Token Retry Idempotency

*For any* `adivahaService` method call where the Adivaha API returns `ErrorCode === 6` on the first attempt, the service MUST:
1. Call `createToken()` exactly once.
2. Retry the original request exactly once using the new token.

If the retry also returns `ErrorCode === 6`, the service MUST throw an error (HTTP 502) without calling `createToken()` a second time. Under no circumstance should `createToken()` be called more than once per original request.

**Validates: Requirements 2.3, 2.4, 16.4**

---

### Property 7: Secret Non-Exposure

*For any* HTTP response produced by any controller in the Backend, the JSON-serialised response body MUST NOT contain the literal string value of `config.PID` or `config.X_API_KEY`. This holds for both success responses (`THttpResponse`) and error responses (`THttpError`), and across all endpoints.

**Validates: Requirements 1.3**

---

### Property 8: Token Cache Round-Trip

*For any* non-empty string `token`, calling `setToken(token)` followed immediately by `getToken()` MUST return that exact string, provided both calls occur within the same UTC calendar day. Calling `clearToken()` between them MUST cause `getToken()` to return `null`.

**Validates: Requirements 2.1**

---

## Error Handling

### Error Classification and HTTP Status Mapping

| Error Source | Condition | HTTP Status | Message |
|---|---|---|---|
| Validation middleware | Required field missing | 400 | `Missing required body field: <field>` |
| Controller guard | OfferedFare ≤ 0 | 422 | `responseMessage.INVALID_OFFERED_FARE` |
| Controller guard | fareQuote OfferedFare = 0 | 422 | `responseMessage.FARE_UNAVAILABLE` |
| Controller guard | Partial cancel missing Sectors/TicketId | 400 | `responseMessage.PARTIAL_CANCEL_FIELDS_REQUIRED` |
| `adivahaService` | Network error (no response) | 503 | `responseMessage.ADIVAHA_UNREACHABLE` |
| `adivahaService` | Non-2xx HTTP from Adivaha | 502 | Adivaha error body forwarded |
| `adivahaService` | ErrorCode_6 double retry | 502 | `responseMessage.TOKEN_EXPIRED` |
| Controller catch | Any unhandled exception | 500 | `responseMessage.SOMETHING_WENT_WRONG` |

### Error Flow

```
adivahaService throws
        │
        ▼
Controller catch block
        │
        └─ httpError(next, error, req, statusCode)
                │
                ▼
        gobalErrorHandler
                │
                ▼
        THttpError JSON response
```

All errors flow through the existing `gobalErrorHandler` via `httpError`. No controller ever calls `res.json()` directly on an error path.

### Secrets in Error Responses

`errorObjects.ts` uses `err instanceof Error ? err.message` as the error message. `adivahaService` errors are constructed with messages that describe the condition (`'Adivaha API is currently unreachable'`) but never echo back the raw Adivaha body containing credentials. The Adivaha response body attached to 502 errors is the supplier's own body — it will not contain the Backend's `PID` or `X_API_KEY`.

---

## Testing Strategy

### Property-Based Testing

The feature has multiple pure functions and universal invariants that are well-suited for property-based testing. The recommended library is **[fast-check](https://fast-check.dev/)** for TypeScript.

**Test runner:** Vitest (or Jest) with fast-check. Each property test runs a minimum of **100 iterations**.

#### Property Test Implementations

**Property 1 — Token Header Injection**
Tag: `Feature: flyanytrip-backend, Property 1: Token injection`
- Generator: arbitrary `adivahaService` method name + arbitrary request body
- Mechanism: mock `adivahaAxios` request interceptor, capture headers
- Assert: captured headers include `PID === config.PID` and `x-api-key === config.X_API_KEY`

**Property 2 — OfferedFare Guard (Booking Calls)**
Tag: `Feature: flyanytrip-backend, Property 2: OfferedFare guard`
- Generator: arbitrary Passengers array where `[0].Fare.OfferedFare` is `fc.oneof(fc.constant(0), fc.constant(null), fc.double({ max: 0 }))`
- Mechanism: call controller handler with mocked `req`/`res`/`next`
- Assert: `next` called with 422 error; `adivahaService.ticketForLcc` / `.flightBook` never called

**Property 3 — Full Cancellation Purity**
Tag: `Feature: flyanytrip-backend, Property 3: Full cancellation purity`
- Generator: arbitrary cancel body with `RequestType: 1`, plus arbitrary `Sectors` and `TicketId` arrays
- Mechanism: spy on `adivahaService.ticketCancel`, capture argument
- Assert: captured body does not have `Sectors` key, does not have `TicketId` key

**Property 4 — Partial Cancellation Completeness**
Tag: `Feature: flyanytrip-backend, Property 4: Partial cancellation completeness`
- Generator: cancel body with `RequestType: 2`, where `Sectors` or `TicketId` is one of `[undefined, null, [], '']`
- Mechanism: call controller handler
- Assert: response status is 400; `adivahaService.ticketCancel` never called

**Property 5 — isDomesticRoute Determinism**
Tag: `Feature: flyanytrip-backend, Property 5: isDomesticRoute determinism`
- Generator A: two codes drawn from `INDIAN_IATA_CODES` via `fc.constantFrom(...INDIAN_IATA_CODES)`
- Generator B: at least one code drawn from `fc.string()` filtered to not be in the set
- Assert A: `isDomesticRoute(from, to) === 'Yes'`
- Assert B: `isDomesticRoute(from, to) === 'No'`

**Property 6 — Token Retry Idempotency**
Tag: `Feature: flyanytrip-backend, Property 6: Token retry idempotency`
- Generator: arbitrary method + body; mock Adivaha to return `ErrorCode: 6` on first call, success on second
- Mechanism: spy on `createToken` call count and request call count
- Assert: `createToken` called exactly 1 time; original endpoint called exactly 2 times total

**Property 7 — Secret Non-Exposure**
Tag: `Feature: flyanytrip-backend, Property 7: Secret non-exposure`
- Generator: arbitrary valid request to any endpoint, mocked Adivaha to return various bodies including bodies containing the word "PID"
- Mechanism: capture full `res.json()` output, serialize to string
- Assert: serialized string does not contain `config.PID` value; does not contain `config.X_API_KEY` value

**Property 8 — Token Cache Round-Trip**
Tag: `Feature: flyanytrip-backend, Property 8: Token cache round-trip`
- Generator: `fc.string({ minLength: 1 })` for token value
- Assert: `setToken(t); getToken() === t`
- Assert (clear): `setToken(t); clearToken(); getToken() === null`

---

### Unit Tests

Unit tests focus on specific examples and edge conditions:

- `getToken()` returns `null` when cache is for a previous UTC day
- `adivahaService.createToken()` stores result in cache via `setToken`
- `validateBody` middleware passes when all fields present; calls `next(error)` when any field missing
- `validateQuery` middleware same as above for `req.query`
- `getLocations` returns 400 when `term` is empty string
- `getFareQuote` returns 422 when `OfferedFare === 0` in Adivaha response
- `cancelTicket` with RequestType=1 logs a warning via `logger.warn`
- `getBookingDetails` returns 400 when both `BookingId` and `PNR` are absent
- `adivahaService` throws 503-mapped error on axios network error (no response)
- `adivahaService` throws 502-mapped error on Adivaha 4xx/5xx HTTP status

### Integration Tests

- `GET /api/v1/flights/token` — end-to-end through actual Express app with mocked axios
- `POST /api/v1/flights/search` — verifies `isDomestic` field appears in forwarded axios call body
- Server startup with missing `PID` → verify `process.exit(1)` is called
- Server startup with all env vars present → verify no exit

### Test File Locations

```
test/
  unit/
    tokenCache.test.ts
    isDomesticRoute.test.ts
    validateBody.test.ts
    validateQuery.test.ts
    adivahaService.test.ts
    flightController.test.ts
  pbt/
    tokenInjection.pbt.ts
    offeredFareGuard.pbt.ts
    fullCancelPurity.pbt.ts
    partialCancelCompleteness.pbt.ts
    isDomesticDeterminism.pbt.ts
    tokenRetryIdempotency.pbt.ts
    secretNonExposure.pbt.ts
    tokenCacheRoundTrip.pbt.ts
  integration/
    flights.integration.test.ts
```

### Test Dependencies to Add (devDependencies)

- `fast-check` — property-based testing
- `vitest` (or `jest` + `ts-jest`) — test runner
- `@types/jest` or Vitest built-in types
- `axios-mock-adapter` — for mocking axios in unit/PBT tests
