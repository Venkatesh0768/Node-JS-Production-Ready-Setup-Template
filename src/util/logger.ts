import { createLogger, format, transports } from 'winston';
import type { ConsoleTransportInstance, FileTransportInstance } from 'winston/lib/winston/transports';
import util from 'util';

export const consoleLogFormat = format.printf((info) => {
    const { level, message, timestamp, meta = {} } = info;

    const customLevel = level.toUpperCase();
    const customTimestamp = timestamp as string;
    const customMessage = message as string;

    const customMeta = util.inspect(meta, {
        showHidden: false,
        depth: null,
        colors: false,
    });

    return `[${customTimestamp}] ${customLevel} ${customMessage}\n META ${customMeta}`;
});

const consoleTransport = (): Array<ConsoleTransportInstance> => {
    return [
        new transports.Console({
            level: 'info',
            format: format.combine(format.timestamp(), consoleLogFormat),
        }),
    ];
};

const fileTransport = (): Array<FileTransportInstance> => {
    return [
        new transports.File({
            level: 'error',
            filename: 'logs/error.log',
            format: format.combine(format.timestamp(), consoleLogFormat),
        }),
    ];
};

export default createLogger({
    defaultMeta: { meta: {} },
    transports: [...consoleTransport(), ...fileTransport()],
});
