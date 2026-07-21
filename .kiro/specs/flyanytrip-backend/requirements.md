# Requirements Document

## Introduction

Flyanytrip Backend is a production-ready REST API service built on top of the existing Node.js/TypeScript/Express scaffold. It acts as a secure orchestration proxy between the Flyanytrip client applications and the Adivaha Flight API (`api.adivaha.io/flights/api/`). The backend injects all Adivaha API credentials (PID and x-api-key) from environment variables server-side, so those secrets are never exposed to clients. The service covers the full flight booking lifecycle: airport lookup, flight search, fare validation, ancillary selection, ticket issuance, post-booking management, and calendar fare tools. A Postman collection (v2.1 format) covering all endpoints must be generated as a final deliverable.

---

## Glossary

- **Adivaha_API**: The third-party flight supplier API hosted at `api.adivaha.io/flights/api/`.
- **Backend**: The Flyanytrip Node.js/TypeScript/Express service being built.
- **Token**: A daily authentication token issued by Adivaha_API's `createToken` endpoint; valid for one calendar day.
- **Token_Cache**: The in-memory store that holds the current Token and its expiry timestamp.
- **PID**: The Adivaha provider identifier, loaded from the `PID` environment variable; never sent to clients.
- **X_API_KEY**: The Adivaha API key, loaded from the `X_API_KEY` environment variable; never sent to clients.
- **TraceId**: A session identifier returned by `searchFlights`; valid for approximately 15 minutes and required by all subsequent booking-flow calls in the same session.
- **ResultIndex**: An opaque string identifying a specific fare within a `searchFlights` response.
- **IsLCC**: A boolean flag returned by `fareQuote` indicating whether the carrier is a Low-Cost Carrier.
- **OfferedFare**: The confirmed fare amount returned by `fareQuote`; MUST be forwarded verbatim to ticketing/booking calls — a value of 0 causes Adivaha error status 7606.
- **FareBreakdown**: The per-passenger fare detail object returned by `fareQuote`.
- **ErrorCode_6**: An Adivaha error code indicating the Token has expired; triggers automatic Token refresh.
- **BookingId**: A unique booking reference returned after a successful hold or ticket issuance.
- **PNR**: Airline passenger name record linked to a BookingId.
- **ChangeRequestId**: An identifier returned by cancellation endpoints to track refund/change status.
- **RequestType_1**: Full cancellation — all passengers, all sectors.
- **RequestType_2**: Partial cancellation — specific passengers and sectors identified by TicketId and Sectors arrays.
- **LCC_Flow**: The ticketing path for LCC carriers using the `ticketForLcc` endpoint.
- **NonLCC_Flow**: The ticketing path for non-LCC carriers using the `flightBook` endpoint.
- **isDomestic**: A string field set to `"Yes"` for India-to-India routes and `"No"` for international routes.
- **SSR**: Special Service Request — optional ancillaries such as baggage, meals, and seat preferences.
- **Postman_Collection**: A JSON file in Postman Collection v2.1 format covering all Backend endpoints with example request bodies.
- **httpResponse**: The existing `src/util/httpResponse.ts` utility used for all successful responses.
- **httpError**: The existing `src/util/httpError.ts` utility used for all error responses.
- **Config**: The existing `src/config/config.ts` module that loads environment variables via `dotenv-flow`.

---

## Requirements

---

### Requirement 1: Environment Configuration

**User Story:** As a backend operator, I want all Adivaha API credentials and service settings loaded exclusively from environment variables, so that secrets are never hard-coded or exposed to clients.

#### Acceptance Criteria

1. THE Config SHALL expose `ADIVAHA_BASE_URL`, `PID`, and `X_API_KEY` fields loaded from the environment via `dotenv-flow`, in addition to the existing `ENV`, `PORT`, and `SERVER_URL` fields.
2. WHEN the Backend starts and any of `PID` or `X_API_KEY` is absent from the environment, THE Backend SHALL log a fatal error and terminate the process with exit code 1.
3. THE Backend SHALL never include `PID` or `X_API_KEY` values in any HTTP response body, log message data field visible to clients, or any externally accessible resource.

---

### Requirement 2: Daily Token Management

**User Story:** As a backend service, I want to automatically obtain and cache the Adivaha daily auth token, so that all outbound Adivaha API calls are authenticated without requiring clients to manage tokens.

#### Acceptance Criteria

1. THE Token_Cache SHALL store the most recently issued Token string and the UTC timestamp at which it was obtained.
2. WHEN an outbound Adivaha API call is about to be made and the Token_Cache is empty, THE Backend SHALL call the Adivaha_API `createToken` endpoint to obtain a fresh Token before proceeding.
3. WHEN the Adivaha_API returns ErrorCode_6 in a response, THE Backend SHALL call the Adivaha_API `createToken` endpoint to refresh the Token and then automatically retry the original request exactly once.
4. WHEN a retry after Token refresh also returns ErrorCode_6, THE Backend SHALL return an HTTP 502 response to the client with a descriptive error message.
5. THE Backend SHALL expose a `GET /api/v1/flights/token` endpoint that triggers Token generation and returns a success message (without the raw Token value) to the caller for operational verification purposes.

---

### Requirement 3: Airport Location Lookup

**User Story:** As a traveller using the Flyanytrip client, I want to search for airports by city name, so that I can select the correct IATA code when booking a flight.

#### Acceptance Criteria

1. THE Backend SHALL expose a `GET /api/v1/flights/locations` endpoint that accepts query parameters `term` (string, required) and `limit` (integer, optional, default 5).
2. WHEN a `GET /api/v1/flights/locations` request is received with a valid `term` parameter, THE Backend SHALL forward the request to the Adivaha_API `flightLocations` endpoint and return the airport list to the client.
3. IF the `term` query parameter is absent or empty, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error message.
4. WHEN the Adivaha_API `flightLocations` call succeeds, THE Backend SHALL return an HTTP 200 response containing the locations data using the `httpResponse` utility.

---

### Requirement 4: Flight Search

**User Story:** As a traveller, I want to search for available flights between two airports on a given date, so that I can compare options and select a flight to book.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/search` endpoint.
2. WHEN a `POST /api/v1/flights/search` request is received with a valid JSON body, THE Backend SHALL forward the request body to the Adivaha_API `searchFlights` endpoint, injecting the current Token, PID, and X_API_KEY server-side.
3. WHEN the Adivaha_API `searchFlights` call succeeds, THE Backend SHALL return an HTTP 200 response containing the full Adivaha response (including `TraceId` and `ResultIndex` array) using the `httpResponse` utility.
4. IF the request body is missing required fields expected by Adivaha_API, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error message.
5. THE Backend SHALL include the `isDomestic` field in the forwarded payload, set to `"Yes"` when the origin and destination are both Indian airports (IATA codes associated with India) and `"No"` otherwise.

---

### Requirement 5: Fare Rules Retrieval

**User Story:** As a traveller, I want to view the cancellation and change penalty policy for a specific fare before booking, so that I can make an informed purchase decision.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/fare-rule` endpoint.
2. WHEN a `POST /api/v1/flights/fare-rule` request is received with `TraceId` and `ResultIndex` in the body, THE Backend SHALL forward those fields to the Adivaha_API `fareRule` endpoint and return the penalty text to the client.
3. IF `TraceId` or `ResultIndex` is absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
4. WHEN the Adivaha_API `fareRule` call succeeds, THE Backend SHALL return an HTTP 200 response using the `httpResponse` utility.

---

### Requirement 6: Fare Quote (Real-Time Price Confirmation)

**User Story:** As a traveller, I want to confirm the real-time price of a selected flight before completing the booking, so that I pay the accurate fare.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/fare-quote` endpoint.
2. WHEN a `POST /api/v1/flights/fare-quote` request is received with `TraceId` and `ResultIndex` in the body, THE Backend SHALL forward those fields to the Adivaha_API `fareQuote` endpoint.
3. WHEN the Adivaha_API `fareQuote` call succeeds, THE Backend SHALL return an HTTP 200 response containing the full `fareQuote` response including `IsLCC`, `FareBreakdown`, `IsGSTMandatory`, and `OfferedFare` fields using the `httpResponse` utility.
4. WHEN the Adivaha_API `fareQuote` response contains `OfferedFare` equal to 0, THE Backend SHALL return an HTTP 422 response with a descriptive error message indicating that the fare is unavailable and the client must re-search.
5. IF `TraceId` or `ResultIndex` is absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.

---

### Requirement 7: Special Service Requests (SSR — Ancillaries)

**User Story:** As a traveller, I want to view available baggage, meal, and seat options for my selected flight, so that I can add preferred ancillaries before booking.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/ssr` endpoint.
2. WHEN a `POST /api/v1/flights/ssr` request is received with `TraceId` and `ResultIndex` in the body, THE Backend SHALL forward those fields to the Adivaha_API `flightSSR` endpoint and return the available ancillary options to the client.
3. IF `TraceId` or `ResultIndex` is absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
4. WHEN the Adivaha_API `flightSSR` call succeeds, THE Backend SHALL return an HTTP 200 response using the `httpResponse` utility.

---

### Requirement 8: LCC Ticket Issuance

**User Story:** As a traveller booking an LCC flight (IsLCC = true from FareQuote), I want the backend to issue the ticket immediately, so that my seat is confirmed right away.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/ticket-lcc` endpoint.
2. WHEN a `POST /api/v1/flights/ticket-lcc` request is received, THE Backend SHALL forward the complete request body — including `TraceId`, `ResultIndex`, `FareBreakdown`, and `OfferedFare` exactly as returned by `fareQuote` — to the Adivaha_API `ticketForLcc` endpoint.
3. IF `OfferedFare` in the request body is 0 or absent, THEN THE Backend SHALL return an HTTP 422 response with a descriptive error message before forwarding to Adivaha_API.
4. WHEN the Adivaha_API `ticketForLcc` call succeeds, THE Backend SHALL return an HTTP 200 response containing the `BookingId` and booking confirmation data using the `httpResponse` utility.
5. IF `TraceId`, `ResultIndex`, or `FareBreakdown` is absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.

---

### Requirement 9: Non-LCC Flight Hold/Book

**User Story:** As a traveller booking a non-LCC flight (IsLCC = false from FareQuote), I want the backend to hold the booking with the airline, so that the reservation is secured pending final ticketing.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/book` endpoint.
2. WHEN a `POST /api/v1/flights/book` request is received, THE Backend SHALL forward the complete request body — including `TraceId`, `ResultIndex`, `FareBreakdown`, and `OfferedFare` exactly as returned by `fareQuote` — to the Adivaha_API `flightBook` endpoint.
3. IF `OfferedFare` in the request body is 0 or absent, THEN THE Backend SHALL return an HTTP 422 response with a descriptive error message before forwarding to Adivaha_API.
4. WHEN the Adivaha_API `flightBook` call succeeds, THE Backend SHALL return an HTTP 200 response containing the `BookingId` and hold confirmation data using the `httpResponse` utility.
5. IF `TraceId`, `ResultIndex`, or `FareBreakdown` is absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.

---

### Requirement 10: Booking Details Retrieval

**User Story:** As a traveller or operator, I want to retrieve the current status and details of a booking by BookingId or PNR, so that I can verify a reservation or troubleshoot an issue.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/booking-details` endpoint.
2. WHEN a `POST /api/v1/flights/booking-details` request is received with a `BookingId` or `PNR` in the body, THE Backend SHALL forward the query to the Adivaha_API `getBookingDetails` endpoint and return the booking status to the client.
3. IF both `BookingId` and `PNR` are absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
4. WHEN the Adivaha_API `getBookingDetails` call succeeds, THE Backend SHALL return an HTTP 200 response using the `httpResponse` utility.

---

### Requirement 11: Cancellation Charges Enquiry

**User Story:** As a traveller, I want to see the exact refund amount before cancelling my ticket, so that I can decide whether to proceed with cancellation.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/cancellation-charges` endpoint.
2. WHEN a `POST /api/v1/flights/cancellation-charges` request is received with a `BookingId` in the body, THE Backend SHALL forward the query to the Adivaha_API `getCancellationCharges` endpoint and return the refund breakdown to the client.
3. IF `BookingId` is absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
4. WHEN the Adivaha_API `getCancellationCharges` call succeeds, THE Backend SHALL return an HTTP 200 response using the `httpResponse` utility.

---

### Requirement 12: Ticket Cancellation

**User Story:** As a traveller, I want to cancel my booked ticket (fully or partially), so that I can receive a refund for eligible segments.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/cancel` endpoint.
2. WHEN a `POST /api/v1/flights/cancel` request is received with `RequestType` equal to 1 (full cancellation), THE Backend SHALL forward the payload to Adivaha_API `ticketCancel` WITHOUT including `Sectors` or `TicketId` fields, even if the client sends them.
3. WHEN a `POST /api/v1/flights/cancel` request is received with `RequestType` equal to 2 (partial cancellation), THE Backend SHALL verify that both `Sectors` and `TicketId` arrays are present and non-empty in the request body before forwarding to Adivaha_API `ticketCancel`.
4. IF `RequestType` is 2 and `Sectors` or `TicketId` is absent or empty, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error indicating both fields are required for partial cancellation.
5. THE Backend SHALL require and forward the `order_id` top-level field in the `ticketCancel` payload; IF `order_id` is absent, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
6. WHEN the Adivaha_API `ticketCancel` call succeeds, THE Backend SHALL return an HTTP 200 response containing the cancellation confirmation and `ChangeRequestId` using the `httpResponse` utility.
7. THE Backend SHALL log a warning-level message before forwarding any cancellation request to Adivaha_API, noting that the operation is irreversible.

---

### Requirement 13: Cancellation/Change Status Check

**User Story:** As a traveller or operator, I want to track the status of a cancellation or refund request by ChangeRequestId, so that I can confirm when the refund has been processed.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/change-status` endpoint.
2. WHEN a `POST /api/v1/flights/change-status` request is received with a `ChangeRequestId` in the body, THE Backend SHALL forward the query to the Adivaha_API `checkChangeStatus` endpoint and return the current status to the client.
3. IF `ChangeRequestId` is absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
4. WHEN the Adivaha_API `checkChangeStatus` call succeeds, THE Backend SHALL return an HTTP 200 response using the `httpResponse` utility.

---

### Requirement 14: Calendar Fare — Monthly Cheapest Fares

**User Story:** As a traveller, I want to see the cheapest available fare for each day in a month for a given route, so that I can plan my travel on the most cost-effective date.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/calendar-fare` endpoint.
2. WHEN a `POST /api/v1/flights/calendar-fare` request is received with route and month parameters in the body, THE Backend SHALL forward the request to the Adivaha_API `GetCalendarFare` endpoint and return the per-day fare data to the client.
3. IF required route or month fields are absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
4. WHEN the Adivaha_API `GetCalendarFare` call succeeds, THE Backend SHALL return an HTTP 200 response using the `httpResponse` utility.

---

### Requirement 15: Calendar Fare — Best Fare for a Specific Day

**User Story:** As a traveller, I want to retrieve the best available fare for a specific travel date on a given route, so that I can confirm the lowest price for that day.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/v1/flights/calendar-fare-day` endpoint.
2. WHEN a `POST /api/v1/flights/calendar-fare-day` request is received with route and date parameters in the body, THE Backend SHALL forward the request to the Adivaha_API `UpdateCalendarFareOfDay` endpoint and return the best fare to the client.
3. IF required route or date fields are absent from the request body, THEN THE Backend SHALL return an HTTP 400 response with a descriptive validation error.
4. WHEN the Adivaha_API `UpdateCalendarFareOfDay` call succeeds, THE Backend SHALL return an HTTP 200 response using the `httpResponse` utility.

---

### Requirement 16: Adivaha API Proxy Service Layer

**User Story:** As a backend developer, I want a centralised service layer that handles all Adivaha API communication, so that credential injection, token management, error normalisation, and retry logic are implemented in one place.

#### Acceptance Criteria

1. THE Backend SHALL implement an `AdivahaService` module at `src/service/adivahaService.ts` that encapsulates all HTTP calls to Adivaha_API.
2. THE AdivahaService SHALL inject the `PID` and `X_API_KEY` headers into every outbound Adivaha_API request automatically, without requiring the caller to provide them.
3. WHEN Adivaha_API returns a non-2xx HTTP status, THE AdivahaService SHALL throw a typed error containing the Adivaha response body, HTTP status, and a descriptive message for the controller to handle.
4. WHEN Adivaha_API returns ErrorCode_6 in the response body, THE AdivahaService SHALL automatically call `createToken`, update the Token_Cache, and retry the original request exactly once before propagating the error.
5. THE AdivahaService SHALL use the `axios` HTTP client library (to be added as a project dependency) for all outbound HTTP requests.
6. THE AdivahaService SHALL log each outbound Adivaha_API request at `info` level and each error response at `error` level using the existing `logger` utility.

---

### Requirement 17: Input Validation Middleware

**User Story:** As a backend developer, I want a reusable validation layer for all incoming request bodies and query parameters, so that malformed requests are rejected early with informative error messages.

#### Acceptance Criteria

1. THE Backend SHALL implement a `validateBody` middleware factory at `src/middleware/validateBody.ts` that accepts a list of required field names and returns an Express middleware function.
2. WHEN a request reaches `validateBody` and one or more required fields are absent or empty in `req.body`, THE validateBody middleware SHALL call `next` with an HTTP 400 error object constructed via the `httpError` utility before the controller executes.
3. WHEN a request reaches `validateBody` and all required fields are present and non-empty, THE validateBody middleware SHALL call `next()` to pass control to the controller.
4. THE Backend SHALL implement a `validateQuery` middleware factory at `src/middleware/validateQuery.ts` that applies the same pattern to `req.query`.

---

### Requirement 18: Unified Error Handling and Response Normalisation

**User Story:** As a client developer consuming the Flyanytrip API, I want consistent JSON error responses for all failure cases, so that my application can handle errors predictably.

#### Acceptance Criteria

1. WHEN an Adivaha_API call fails with a network error (no response received), THE Backend SHALL return an HTTP 503 response to the client with message "Adivaha API is currently unreachable".
2. WHEN an Adivaha_API call returns a 4xx or 5xx HTTP status, THE Backend SHALL return an HTTP 502 response to the client containing the Adivaha error code and message from the response body.
3. WHEN an unhandled exception occurs in any controller, THE Backend SHALL pass the error to the existing `globalErrorHandler` middleware via `httpError`, which returns a structured `THttpError` JSON body.
4. THE Backend SHALL extend `responseMessage.ts` with all Flyanytrip-specific message constants required by the new endpoints (e.g., `FARE_UNAVAILABLE`, `TOKEN_EXPIRED`, `PARTIAL_CANCEL_FIELDS_REQUIRED`, `CANCELLATION_IRREVERSIBLE_WARNING`).

---

### Requirement 19: Postman Collection Generation

**User Story:** As a developer or QA engineer, I want a ready-to-import Postman collection covering all Flyanytrip Backend endpoints, so that I can test the API immediately without manually building requests.

#### Acceptance Criteria

1. THE Backend SHALL include a `postman_collection.json` file at the project root in Postman Collection v2.1 format.
2. THE Postman_Collection SHALL contain one request item for every endpoint defined in Requirements 2 through 15, organised into named folders matching the functional grouping (Utility, Booking Flow, Post-Booking, Fare Tools).
3. WHEN a Postman request requires a body, THE Postman_Collection SHALL include a realistic example JSON request body for that request.
4. THE Postman_Collection SHALL use a `{{base_url}}` collection variable defaulting to `http://localhost:3000/api/v1` so that users can override the base URL for different environments.
5. THE Postman_Collection SHALL NOT include any real values for `PID` or `X_API_KEY` in request bodies or headers — those are server-side only.
