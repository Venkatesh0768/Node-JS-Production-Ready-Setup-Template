import app from './app';
import config from './config/config';
import logger from './util/logger';

// Startup guard — fail fast if required Adivaha credentials are missing
if (!config.PID || !config.X_API_KEY) {
    logger.error('FATAL: PID and X_API_KEY environment variables are required', {
        meta: { PID: config.PID ? '[SET]' : '[MISSING]', X_API_KEY: config.X_API_KEY ? '[SET]' : '[MISSING]' },
    });
    process.exit(1);
}

const server = app.listen(config.PORT);

(() => {
    try {
        logger.info('App Started', {
            meta: {
                PORT: config.PORT,
                SERVER_URL: config.SERVER_URL,
            },
        });
    } catch (error) {
        logger.error('Application Error', { meta: error });

        server.close((closeError) => {
            if (closeError) {
                logger.error('Server Close Error', { meta: closeError });
            }
            process.exit(1);
        });
    }
})();
