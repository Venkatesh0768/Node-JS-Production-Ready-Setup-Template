import axios, { AxiosError, AxiosInstance } from 'axios';
import config from '../config/config';
import logger from '../util/logger';
import responseMessage from '../constant/responseMessage';
import { clearToken, getToken, setToken } from './tokenCache';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdivahaTokenResponse {
    Token_Status: string;
    Token: string;
    Token_Expiry?: string;
    [key: string]: unknown;
}

interface AdivahaBody {
    ErrorCode?: number;
    [key: string]: unknown;
}

export class AdivahaError extends Error {
    public readonly httpStatus: number;
    public readonly adivahaBody?: unknown;

    constructor(message: string, httpStatus: number, adivahaBody?: unknown) {
        super(message);
        this.name = 'AdivahaError';
        this.httpStatus = httpStatus;
        this.adivahaBody = adivahaBody;
    }
}

// ── Shared axios instance ──────────────────────────────────────────────────────

const adivahaAxios: AxiosInstance = axios.create({
    baseURL: config.ADIVAHA_BASE_URL,
    headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    },
});

// ── Request interceptor — inject PID, x-api-key, and TokenId on every call ───
// Adivaha requires:
//   - PID header
//   - x-api-key header
//   - TokenId query param (except on createToken itself)
adivahaAxios.interceptors.request.use((reqConfig) => {
    // Always inject credentials
    reqConfig.headers['PID'] = config.PID as string;
    reqConfig.headers['x-api-key'] = config.X_API_KEY as string;

    // Inject token as query param on all calls EXCEPT createToken
    // (createToken generates the token, it doesn't need one)
    const action = (reqConfig.params as Record<string, string> | undefined)?.action;
    if (action !== 'createToken') {
        const token = getToken();
        if (token) {
            reqConfig.params = {
                ...(reqConfig.params as Record<string, unknown>),
                TokenId: token,
            };
        }
    }

    logger.info(`AdivahaService → [${action ?? 'unknown'}]`);
    return reqConfig;
});

// ── Token management ───────────────────────────────────────────────────────────

async function createToken(): Promise<AdivahaTokenResponse> {
    logger.info('AdivahaService: calling createToken');
    const response = await adivahaAxios.get<AdivahaTokenResponse>('', {
        params: { action: 'createToken' },
    });
    const data = response.data;
    if (data?.Token) {
        setToken(data.Token);
        logger.info('AdivahaService: token cached successfully', {
            meta: { Token_Status: data.Token_Status, Token_Expiry: data.Token_Expiry },
        });
    } else {
        logger.warn('AdivahaService: createToken returned no Token', { meta: data });
    }
    return data;
}

async function ensureToken(): Promise<void> {
    if (!getToken()) {
        await createToken();
    }
}

// ── Core request wrapper with auto-retry on ErrorCode 6 ───────────────────────

async function callAdivaha<T>(fn: () => Promise<T>, isRetry = false): Promise<T> {
    await ensureToken();
    try {
        const result = await fn();

        // Adivaha sometimes returns errors in a 200 response body
        const body = result as AdivahaBody;
        if (body?.ErrorCode === 6) {
            if (isRetry) {
                throw new AdivahaError(responseMessage.TOKEN_EXPIRED, 502, body);
            }
            logger.info('AdivahaService: ErrorCode 6 — refreshing token and retrying once');
            clearToken();
            await createToken();
            return callAdivaha(fn, true);
        }

        return result;
    } catch (err) {
        if (err instanceof AdivahaError) throw err;

        const axiosErr = err as AxiosError<AdivahaBody>;

        if (!axiosErr.response) {
            // Network error — Adivaha unreachable
            logger.error('AdivahaService: network error', { meta: axiosErr.message });
            throw new AdivahaError(responseMessage.ADIVAHA_UNREACHABLE, 503);
        }

        const status = axiosErr.response.status;
        const body = axiosErr.response.data;

        // Token expired in error response
        if (body?.ErrorCode === 6) {
            if (isRetry) {
                throw new AdivahaError(responseMessage.TOKEN_EXPIRED, 502, body);
            }
            logger.info('AdivahaService: ErrorCode 6 in error body — refreshing token and retrying once');
            clearToken();
            await createToken();
            return callAdivaha(fn, true);
        }

        logger.error('AdivahaService: upstream error', { meta: { status, body } });
        throw new AdivahaError(`Adivaha API returned ${status}`, 502, body);
    }
}

// ── 14 proxy methods ──────────────────────────────────────────────────────────

export const adivahaService = {
    createToken,

    flightLocations(term: string, limit: number = 5): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .get('', { params: { action: 'flightLocations', term, limit } })
                .then((r) => r.data),
        );
    },

    searchFlights(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'searchFlights' } })
                .then((r) => r.data),
        );
    },

    fareRule(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'fareRule' } })
                .then((r) => r.data),
        );
    },

    fareQuote(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'fareQuote' } })
                .then((r) => r.data),
        );
    },

    flightSSR(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'flightSSR' } })
                .then((r) => r.data),
        );
    },

    ticketForLcc(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'ticketForLcc' } })
                .then((r) => r.data),
        );
    },

    flightBook(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'flightBook' } })
                .then((r) => r.data),
        );
    },

    getBookingDetails(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'getBookingDetails' } })
                .then((r) => r.data),
        );
    },

    getCancellationCharges(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'getCancellationCharges' } })
                .then((r) => r.data),
        );
    },

    ticketCancel(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'ticketCancel' } })
                .then((r) => r.data),
        );
    },

    checkChangeStatus(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'checkChangeStatus' } })
                .then((r) => r.data),
        );
    },

    getCalendarFare(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'GetCalendarFare' } })
                .then((r) => r.data),
        );
    },

    updateCalendarFareOfDay(body: unknown): Promise<unknown> {
        return callAdivaha(() =>
            adivahaAxios
                .post('', body, { params: { action: 'UpdateCalendarFareOfDay' } })
                .then((r) => r.data),
        );
    },
};
