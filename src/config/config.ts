import dotenvflow from 'dotenv-flow';

dotenvflow.config();

export default {
    ENV: process.env.ENV,
    PORT: process.env.PORT,
    SERVER_URL: process.env.SERVER_URL,
    // Database — Supabase (transaction pooler + direct for migrations)
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    // Adivaha Flight API credentials
    ADIVAHA_BASE_URL: process.env.ADIVAHA_BASE_URL ?? 'https://api.adivaha.io/flights/api/',
    PID: process.env.PID,
    X_API_KEY: process.env.X_API_KEY,
};
