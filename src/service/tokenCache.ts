interface TokenCacheState {
    token: string | null;
    obtainedAt: number | null; // UTC milliseconds (Date.now())
}

const cache: TokenCacheState = {
    token: null,
    obtainedAt: null,
};

/**
 * Returns the cached token if it was obtained on the current UTC calendar day.
 * Returns null if the cache is cold or the token is from a previous day.
 */
export function getToken(): string | null {
    if (cache.token === null || cache.obtainedAt === null) {
        return null;
    }
    const obtainedDate = new Date(cache.obtainedAt).toDateString();
    const todayDate = new Date().toDateString();
    if (obtainedDate !== todayDate) {
        return null;
    }
    return cache.token;
}

/**
 * Stores a new token and records the current UTC timestamp.
 */
export function setToken(token: string): void {
    cache.token = token;
    cache.obtainedAt = Date.now();
}

/**
 * Clears the token cache.
 */
export function clearToken(): void {
    cache.token = null;
    cache.obtainedAt = null;
}
