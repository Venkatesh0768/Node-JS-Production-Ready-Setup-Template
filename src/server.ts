import app from './app';
import config from './config/config';

const server = app.listen(config.PORT);

(() => {
    try {

        // eslint-disable-next-line no-console
        console.info('App Started', {
            meta: {
                PORT: config.PORT,
                SERVER_URL: config.SERVER_URL,
            },
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Application Error', { meta: error });

        server.close((closeError) => {
            if (closeError) {
                // eslint-disable-next-line no-console
                console.error('Server Close Error', { meta: closeError });
            }
            process.exit(1);
        });
    }
})();