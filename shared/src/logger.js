import pino from 'pino';

export class Logger {
    constructor(options = {}) {
        const loggerOptions = {
            level: process.env.LOG_LEVEL || 'debug',
            base: {
                service: options.serviceName || 'unknown',
                service_id: options.serviceId || 'unknown',
                environment: process.env.NODE_ENV || 'development'
            }
        };

        const targets = [{
            target: 'pino-pretty',
            level: 'debug',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
            }
        }];

        if (options.logstashHost) {
            targets.push({
                target: 'pino-socket',
                level: 'debug',
                options: {
                    mode: 'tcp',
                    address: options.logstashHost,
                    port: options.logstashPort || 5000,
                    reconnect: true,
                    recover: true
                }
            });
        }

        const transport = pino.transport({
            targets,
            levels: pino.levels.values
        });

        // Handle transport-level errors
        transport.on('error', (err) => {
            console.error('Transport error:', {
                error: err.message,
                code: err.code,
                syscall: err.syscall,
                address: err.address,
                port: err.port
            });
        });

        // Handle transport ready event
        transport.on('ready', () => {
            console.log('All transports initialized successfully');
        });

        this.logger = pino(loggerOptions, transport);
    }

    debug(message, meta = {}) {
        this.logger.debug(meta, message);
    }

    info(message, meta = {}) {
        this.logger.info(meta, message);
    }

    warn(message, meta = {}) {
        this.logger.warn(meta, message);
    }

    error(message, meta = {}) {
        if (meta.error instanceof Error) {
            meta = {
                ...meta,
                error: {
                    message: meta.error.message,
                    stack: meta.error.stack,
                    code: meta.error.code,
                    name: meta.error.name
                }
            };
        }
        this.logger.error(meta, message);
    }

    fatal(message, meta = {}) {
        this.logger.fatal(meta, message);
    }

    child(bindings) {
        return this.logger.child(bindings);
    }

    close() {
        this.logger.flush();
    }
} 